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

        // Safe JWT Secret Fallback
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
        const { firstName, lastName, email, phone, propertyName, dates, homestayId, checkIn, checkOut, nights, totalPrice } = req.body;

        let targetEmail = '';
        let validHomestayId = null;
        let propertyAddress = 'Guwahati, Assam';
        let googleMapsUrl = '';

        if (homestayId && homestayId !== 'unknown' && mongoose.Types.ObjectId.isValid(homestayId)) {
            const property = await Homestay.findById(homestayId);
            if (property) {
                validHomestayId = homestayId;
                targetEmail = property.ownerEmail || (property.host && property.host.email) || '';
                
                // Extract location details if present on the homestay model
                propertyAddress = property.address || property.locality || property.location || 'Guwahati, Assam';
                googleMapsUrl = property.mapUrl || property.googleMapsLink || '';
            }
        }

        const formattedDates = dates || (checkIn && checkOut ? `${checkIn} to ${checkOut}` : 'N/A');
        const formattedPropertyName = propertyName || req.body.title || 'Homestay';

        // Fallback map URL if no custom link exists in MongoDB
        if (!googleMapsUrl) {
            const searchQuery = encodeURIComponent(`${formattedPropertyName} ${propertyAddress}`);
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`;
        }

        const newBooking = new Booking({ 
            firstName, 
            lastName, 
            email, 
            phone,
            userId: req.body.userId || null,
            propertyId: validHomestayId,
            propertyName: formattedPropertyName, 
            dates: formattedDates, 
            checkInDate: checkIn || null,
            checkOutDate: checkOut || null,
            homestayId: validHomestayId,
            hostEmail: targetEmail,
            nights: nights || 1,
            totalPrice: totalPrice || 0
        });
        
        await newBooking.save();

        // 1. EMAIL TO THE HOST
        if (targetEmail) {
            try {
                await resend.emails.send({
                    from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                    to: targetEmail, 
                    subject: 'New Booking Request for ' + formattedPropertyName,
                    html: `<h2>New Booking Request</h2>
                           <p><strong>Guest:</strong> ${firstName} ${lastName}</p>
                           <p><strong>Contact:</strong> ${email} | ${phone}</p>
                           <p><strong>Dates:</strong> ${formattedDates}</p>
                           <p><strong>Total Price:</strong> ₹${totalPrice || 0}</p>`
                });
                console.log(`[BOOKING] Host email sent to: ${targetEmail}`);
            } catch (hostErr) {
                console.error("[BOOKING] Host email error:", hostErr.message);
            }
        }

        // 2. EMAIL TO THE GUEST (Includes Google Maps Button)
        if (email) {
            try {
                await resend.emails.send({
                    from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                    to: email, 
                    subject: 'Booking Request Received - ' + formattedPropertyName,
                    html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f9; padding: 40px 15px; margin: 0;">
                        <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                            
                            <!-- Header / Branding Banner -->
                            <div style="background-color: #0f172a; padding: 28px 32px; text-align: center;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">StayGuwahati</h1>
                            </div>

                            <!-- Main Body -->
                            <div style="padding: 32px 28px;">
                                <h2 style="color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 600; margin-bottom: 8px;">Booking Request Received! 🎉</h2>
                                <p style="font-size: 15px; color: #475569; margin: 0 0 20px 0; line-height: 1.5;">
                                    Hi <strong>${firstName}</strong>,
                                </p>
                                <p style="font-size: 15px; color: #475569; margin: 0 0 24px 0; line-height: 1.5;">
                                    Thank you for choosing StayGuwahati! We have received your reservation request for <strong style="color: #0f172a;">${formattedPropertyName}</strong>.
                                </p>

                                <!-- Details Box -->
                                <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
                                    <h3 style="margin: 0 0 16px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; font-weight: 600;">Reservation Overview</h3>
                                    
                                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                                        <tr>
                                            <td style="padding: 10px 0; color: #64748b; width: 40%;">Property</td>
                                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600; text-align: right;">${formattedPropertyName}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; color: #64748b; border-top: 1px solid #e2e8f0;">Dates</td>
                                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600; text-align: right; border-top: 1px solid #e2e8f0;">${formattedDates}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; color: #64748b; border-top: 1px solid #e2e8f0;">Duration</td>
                                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600; text-align: right; border-top: 1px solid #e2e8f0;">${nights || 1} Night(s)</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px 0 0 0; color: #0f172a; font-weight: 700; border-top: 2px solid #cbd5e1; font-size: 15px;">Total Amount</td>
                                            <td style="padding: 12px 0 0 0; color: #16a34a; font-weight: 700; font-size: 18px; text-align: right; border-top: 2px solid #cbd5e1;">₹${totalPrice || 0}</td>
                                        </tr>
                                    </table>
                                </div>

                                <!-- Location & Map Card -->
                                <div style="background-color: #ffffff; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #e2e8f0; text-align: center;">
                                    <h3 style="margin: 0 0 6px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; font-weight: 600;">Property Location</h3>
                                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155;">📍 ${propertyAddress}</p>
                                    <a href="${googleMapsUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 11px 22px; border-radius: 6px; font-size: 14px; font-weight: 600;">
                                        Get Directions on Google Maps
                                    </a>
                                </div>

                                <!-- Next Steps Callout -->
                                <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 16px; border-radius: 4px; margin-bottom: 24px;">
                                    <p style="margin: 0; font-size: 14px; color: #166534; line-height: 1.4;">
                                        📌 <strong>Next Step:</strong> Your host will review your request and contact you shortly to confirm your check-in details.
                                    </p>
                                </div>

                                <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.5;">
                                    If you have any questions or need to make changes, simply reply directly to this email.
                                </p>
                            </div>

                            <!-- Footer -->
                            <div style="background-color: #f8fafc; padding: 20px 28px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
                                <p style="margin: 0 0 4px 0; font-weight: 500; color: #64748b;">StayGuwahati</p>
                                <p style="margin: 0;">Guwahati, Assam, India • <a href="https://stayguwahati.in" style="color: #2563eb; text-decoration: none;">stayguwahati.in</a></p>
                            </div>

                        </div>
                    </div>
                    `
                });
                console.log(`[BOOKING] Guest email sent to: ${email}`);
            } catch (guestErr) {
                console.error("[BOOKING] Guest email error:", guestErr.message);
            }
        }

        // 3. WHATSAPP & SMS TO THE GUEST (Twilio)
        if (phone) {
            const formattedPhone = phone.startsWith('+') ? phone : `+91${phone.trim()}`;

            if (process.env.TWILIO_WHATSAPP_NUMBER) {
                try {
                    const waSender = process.env.TWILIO_WHATSAPP_NUMBER.trim().startsWith('+') 
                        ? process.env.TWILIO_WHATSAPP_NUMBER.trim() 
                        : `+${process.env.TWILIO_WHATSAPP_NUMBER.trim()}`;

                    await twilioClient.messages.create({
                        from: `whatsapp:${waSender}`,
                        to: `whatsapp:${formattedPhone}`,
                        body: `Hello ${firstName}! 🏠 Your StayGuwahati booking request for *${formattedPropertyName}* (${formattedDates}) has been received. Total: ₹${totalPrice || 0}. Location: ${googleMapsUrl}`
                    });
                    console.log(`[BOOKING] WhatsApp sent to: ${formattedPhone}`);
                } catch (whatsappErr) {
                    console.error("[BOOKING] WhatsApp error:", whatsappErr.message);
                }
            }

            if (process.env.TWILIO_PHONE_NUMBER) {
                try {
                    await twilioClient.messages.create({
                        from: process.env.TWILIO_PHONE_NUMBER.trim(),
                        to: formattedPhone,
                        body: `Hello ${firstName}! Your StayGuwahati booking request for ${formattedPropertyName} (${formattedDates}) is received. Total: RS ${totalPrice || 0}.`
                    });
                    console.log(`[BOOKING] SMS sent to: ${formattedPhone}`);
                } catch (smsErr) {
                    console.error("[BOOKING] SMS error:", smsErr.message);
                }
            }
        }

        res.status(200).json({ success: true, message: "Booking saved and notifications dispatched!", data: newBooking });
    } catch (error) {
        console.error("Booking route error:", error);
        res.status(500).json({ success: false, message: "Server error during booking." });
    }
});

        res.status(200).json({ success: true, message: "Booking saved and notifications dispatched!", data: newBooking });
    } catch (error) {
        console.error("Booking route error:", error);
        res.status(500).json({ success: false, message: "Server error during booking." });
    }
});

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