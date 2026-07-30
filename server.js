require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const twilio = require('twilio');

// Initialize Resend & Twilio
const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Models
const Homestay = require('./models/Homestay');
const Ticket = require('./models/Ticket');
const User = require('./models/User');
const Booking = require('./models/Booking');
const Message = require('./models/message');

const app = express();

// CORS Configuration
const allowedOrigins = [
    'https://stayguwahati.in',
    'https://www.stayguwahati.in',
    'https://stayguwahati-backend.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            return callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure uploads folder exists dynamically
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Expose static files
app.use('/uploads', express.static(uploadDir));

// --- MULTER STORAGE SETUP ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (JPG, PNG, WebP) are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected securely to MongoDB Atlas Instance.'))
    .catch(err => console.error('❌ DATABASE CONNECTION CRASHED!', err.message));

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. Token missing.' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'stayguwahati_jwt_super_secret_key_2026';

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
        req.user = user;
        next();
    });
};

// --- API ROUTES ---

// 1. Support Ticket Route
app.post('/api/tickets', async (req, res) => {
    try {
        const { subject, description, category } = req.body;
        if (!subject || !description) {
            return res.status(400).json({ success: false, message: 'Subject and description are required.' });
        }

        const newTicket = new Ticket({ subject, description, category });
        await newTicket.save();

        await resend.emails.send({
            from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
            to: process.env.EMAIL_USER,
            subject: `New Support Ticket: ${subject}`,
            text: `You have a new support request:\n\nCategory: ${category}\nDescription: ${description}`
        });

        res.status(200).json({ success: true, message: 'Ticket saved and email sent!' });
    } catch (err) {
        console.error("Ticket route error:", err);
        res.status(500).json({ success: false, message: 'Failed to process ticket.' });
    }
});

// 2. Authentication: Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ success: false, message: "Invalid credentials." });

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials." });

        const jwtSecret = process.env.JWT_SECRET || 'stayguwahati_jwt_super_secret_key_2026';

        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            jwtSecret,
            { expiresIn: '7d' }
        );

        res.status(200).json({
            success: true,
            token: token,
            user: { 
                id: user._id, 
                name: user.name, 
                email: user.email,
                role: user.role 
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: error.message || "Auth error." });
    }
});

// 3. Authentication: Register
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        if (!email || !password || !name) {
            return res.status(400).json({ success: false, message: "Name, email, and password are required." });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists." });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await User.create({ name, email: email.toLowerCase(), passwordHash });
        res.status(201).json({ success: true, message: "Registration successful!" });
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// 3.5 Authentication: Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required." });
        }

        console.log(`[RESET] Password reset requested for: ${email}`);

        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
            console.log(`[RESET] ❌ Email ${email} not found in database.`);
            return res.status(200).json({ success: true, message: "If your email is registered, a reset link has been sent." });
        }

        console.log(`[RESET] ✅ User found. Generating token...`);
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetToken = resetToken;
        user.resetTokenExpiry = Date.now() + 3600000; // 1 hour validity
        await user.save();

        const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
        const resetLink = `${clientUrl}/reset-password.html?token=${resetToken}`;

        const emailResult = await resend.emails.send({
            from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
            to: user.email,
            subject: 'Password Reset Request - StayGuwahati',
            html: `<h3>Password Reset</h3><p>Click the link below to reset your password (valid for 1 hour):</p><a href="${resetLink}">${resetLink}</a>`
        });

        console.log(`[RESET] ✉️ Resend API Response:`, emailResult);
        res.status(200).json({ success: true, message: "Reset link sent to your email!" });
    } catch (error) {
        console.error("[RESET] ❌ Error during password reset:", error);
        res.status(500).json({ success: false, message: "Server error during password reset." });
    }
});

// 3.6 Authentication: Reset Password Complete
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: "Reset token and new password are required." });
        }

        const user = await User.findOne({
            resetToken: token,
            resetTokenExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset token." });
        }

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);
        user.resetToken = undefined;
        user.resetTokenExpiry = undefined;
        await user.save();

        res.status(200).json({ success: true, message: "Password reset successful! You can now log in." });
    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ success: false, message: "Server error during password reset." });
    }
});

// 4. Booking Routes
app.get('/api/bookings', async (req, res) => {
    try {
        const { email } = req.query;
        let query = {};

        if (email) {
            query = {
                $or: [
                    { email: email.toLowerCase() },
                    { hostEmail: email.toLowerCase() }
                ]
            };
        }

        const bookings = await Booking.find(query).populate('homestayId');
        res.json({ success: true, data: bookings });
    } catch (err) {
        console.error("Fetch bookings error:", err);
        res.status(500).json({ success: false, message: "Error loading bookings" });
    }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const { 
            firstName, 
            lastName, 
            email, 
            phone, 
            propertyName, 
            dates, 
            homestayId, 
            checkIn, 
            checkOut, 
            nights, 
            totalPrice 
        } = req.body;

        // 1. Mandatory Input Validation
        if (!firstName || !lastName || !email || !phone) {
            return res.status(400).json({ 
                success: false, 
                message: "First name, last name, email, and phone number are required." 
            });
        }

        if (!homestayId || homestayId === 'unknown' || !mongoose.Types.ObjectId.isValid(homestayId)) {
            return res.status(400).json({ 
                success: false, 
                message: "A valid Homestay ID is required to complete a booking." 
            });
        }

        const validHomestayId = new mongoose.Types.ObjectId(homestayId);

        // Fetch property details
        const property = await Homestay.findById(validHomestayId);
        if (!property) {
            return res.status(444).json({ success: false, message: "Property not found." });
        }

        const targetEmail = property.ownerEmail || (property.host && property.host.email) || '';
        const propertyAddress = property.address || property.locality || property.location || 'Guwahati, Assam';
        let googleMapsUrl = property.mapUrl || property.googleMapsLink || '';

        // 2. Parse & Validate Dates
        let parsedCheckIn = checkIn ? new Date(checkIn) : null;
        let parsedCheckOut = checkOut ? new Date(checkOut) : null;

        if ((!parsedCheckIn || isNaN(parsedCheckIn)) && dates && dates.includes('to')) {
            const parts = dates.split('to').map(s => s.trim());
            parsedCheckIn = new Date(parts[0]);
            parsedCheckOut = new Date(parts[1]);
        }

        if (!parsedCheckIn || isNaN(parsedCheckIn) || !parsedCheckOut || isNaN(parsedCheckOut)) {
            return res.status(400).json({ 
                success: false, 
                message: "Valid check-in and check-out dates are required." 
            });
        }

        // 3. Date Overlap Availability Check
        const existingBooking = await Booking.findOne({
            $or: [
                { homestayId: validHomestayId },
                { propertyId: validHomestayId }
            ],
            status: { $nin: ['cancelled', 'rejected'] },
            checkInDate: { $lt: parsedCheckOut }, 
            checkOutDate: { $gt: parsedCheckIn }
        });

        if (existingBooking) {
            return res.status(400).json({ 
                success: false, 
                message: "These dates are no longer available for this property. Please choose different dates." 
            });
        }

        const formattedDates = dates || `${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]}`;
        const formattedPropertyName = propertyName || property.title || 'Homestay';

        if (!googleMapsUrl) {
            const searchQuery = encodeURIComponent(`${formattedPropertyName} ${propertyAddress}`);
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`;
        }

        // 4. Create and Save Booking
        const newBooking = new Booking({ 
            firstName, 
            lastName, 
            email: email.toLowerCase(), 
            phone,
            userId: req.body.userId || null,
            propertyId: validHomestayId,
            homestayId: validHomestayId,
            propertyName: formattedPropertyName, 
            dates: formattedDates, 
            checkInDate: parsedCheckIn,
            checkOutDate: parsedCheckOut,
            hostEmail: targetEmail,
            nights: nights || 1,
            totalPrice: totalPrice || 0,
            status: req.body.status || 'Confirmed'
        });
        
        await newBooking.save();

        // 5. Send Dual Email Notifications (Guest + Host)
        const emailPromises = [];

        // --- EMAIL 1: TO GUEST / CUSTOMER ---
        if (email) {
            emailPromises.push(
                resend.emails.send({
                    from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                    to: email.toLowerCase(),
                    subject: `Booking Confirmed: ${formattedPropertyName}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                            <h2 style="color: #0d9488;">Booking Confirmed!</h2>
                            <p>Hi ${firstName} ${lastName},</p>
                            <p>Your booking for <strong>${formattedPropertyName}</strong> has been successfully confirmed.</p>
                            <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                <p style="margin: 4px 0;"><strong>Dates:</strong> ${formattedDates}</p>
                                <p style="margin: 4px 0;"><strong>Nights:</strong> ${nights || 1}</p>
                                <p style="margin: 4px 0;"><strong>Total Amount:</strong> ₹${totalPrice || 0}</p>
                                <p style="margin: 4px 0;"><strong>Address:</strong> ${propertyAddress}</p>
                            </div>
                            <p><a href="${googleMapsUrl}" style="background-color: #0d9488; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px;">View Location on Google Maps</a></p>
                        </div>
                    `
                }).catch(err => console.error("Guest email dispatch error:", err.message))
            );
        }

        // --- EMAIL 2: TO HOST / ADMIN ---
        if (targetEmail) {
            emailPromises.push(
                resend.emails.send({
                    from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                    to: targetEmail, 
                    subject: 'New Booking Request for ' + formattedPropertyName,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                            <h2>New Booking Received</h2>
                            <p>You have received a new booking for <strong>${formattedPropertyName}</strong>.</p>
                            <ul>
                                <li><strong>Guest Name:</strong> ${firstName} ${lastName}</li>
                                <li><strong>Guest Email:</strong> ${email}</li>
                                <li><strong>Guest Phone:</strong> ${phone}</li>
                                <li><strong>Dates:</strong> ${formattedDates}</li>
                                <li><strong>Total Amount:</strong> ₹${totalPrice || 0}</li>
                            </ul>
                        </div>
                    `
                }).catch(err => console.error("Host email dispatch error:", err.message))
            );
        }

        await Promise.all(emailPromises);

        return res.status(200).json({ 
            success: true, 
            message: "Booking saved and confirmed!", 
            data: newBooking 
        });

    } catch (error) {
        if (error.name === 'ValidationError') {
            console.error("Mongoose Validation Error:", error.message);
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "This homestay was just booked for these dates. Please pick another date."
            });
        }

        console.error("Booking route unexpected error:", error);
        res.status(500).json({ success: false, message: error.message || "Server error during booking." });
    }
});

// 4.5 Messages Route
app.post('/api/messages/send', async (req, res) => {
    try {
        const { recipientPhone, message, senderName, propertyTitle, guestName } = req.body;

        if (!message || !propertyTitle || !guestName) {
            return res.status(400).json({ success: false, error: "Missing required message fields." });
        }

        const newMessage = new Message({
            propertyTitle,
            guestName,
            senderName: senderName || 'User',
            message,
            recipientPhone: recipientPhone || ''
        });
        await newMessage.save();

        let twilioSid = null;
        if (recipientPhone && process.env.TWILIO_PHONE_NUMBER) {
            try {
                const twilioResponse = await twilioClient.messages.create({
                    body: `[StayGuwahati] Message from ${senderName} regarding ${propertyTitle}: "${message}"`,
                    from: process.env.TWILIO_PHONE_NUMBER.trim(),
                    to: recipientPhone.startsWith('+') ? recipientPhone : `+91${recipientPhone.trim()}`
                });
                twilioSid = twilioResponse.sid;
            } catch (twilioErr) {
                console.error("Twilio SMS Dispatch Warning:", twilioErr.message);
            }
        }

        res.status(200).json({ 
            success: true, 
            message: "Message saved and dispatched successfully.",
            data: newMessage,
            sid: twilioSid 
        });

    } catch (error) {
        console.error("Message Saving Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. File Upload
app.post('/api/upload-images', (req, res) => {
    upload.array('photos', 3)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No images uploaded.' });
        }

        const filePaths = req.files.map(file => `/uploads/${file.filename}`);
        res.status(200).json({ success: true, images: filePaths });
    });
});

// 6. Homestay Operations
const getHomestaysHandler = async (req, res) => {
    try {
        const { locality, maxPrice, feature, status } = req.query;
        let queryFilter = {}; 

        if (status) {
            queryFilter.status = status.toLowerCase();
        } else {
            queryFilter.status = 'approved';
        }

        if (locality) queryFilter.locality = locality;
        if (maxPrice) queryFilter.pricePerNight = { $lte: Number(maxPrice) };
        if (feature) queryFilter.features = { $in: [feature] };

        const listings = await Homestay.find(queryFilter).sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: listings.length, data: listings });
    } catch (error) {
        console.error("GET homestays error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

app.get('/api/homestays', getHomestaysHandler);
app.get('/api/properties', getHomestaysHandler);

app.get('/api/homestays/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid ID format" });
        }

        const homestay = await Homestay.findById(req.params.id);
        if (!homestay) return res.status(404).json({ success: false, message: "Property not found" });
        
        res.status(200).json({ success: true, data: homestay });
    } catch (error) {
        console.error("GET single homestay error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/homestays', async (req, res) => {
    try {
        const formattedData = {
            ...req.body,
            host: {
                name: req.body.owner || (req.body.host && req.body.host.name) || "Unknown Host",
                phone: req.body.phone || (req.body.host && req.body.host.phone) || "",
                email: req.body.email || (req.body.host && req.body.host.email) || ""
            },
            status: req.body.status ? req.body.status.toLowerCase() : 'pending'
        };

        const newStay = await Homestay.create(formattedData);
        res.status(201).json({ success: true, message: 'Listing created!', data: newStay });
    } catch (error) {
        console.error("❌ MONGODB VALIDATION/SAVE ERROR:", error.message);
        res.status(400).json({ success: false, message: 'Validation failed', error: error.message });
    }
});

// 7. Admin Status Update (Protected by JWT)
app.patch('/api/admin/homestays/:id/status', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Property ID format" });
        }

        if (!req.body.status) {
            return res.status(400).json({ success: false, message: "Status is required in request body" });
        }

        const updatedProperty = await Homestay.findByIdAndUpdate(
            req.params.id, 
            { status: req.body.status.toLowerCase() }, 
            { new: true, runValidators: true }
        );
        
        if (!updatedProperty) return res.status(404).json({ success: false, message: "Property not found." });
        res.json({ success: true, message: "Status updated!", data: updatedProperty });
    } catch (err) {
        console.error("Admin status update error:", err);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`StayGuwahati Core Engine running on port ${PORT}`);
});