require('dotenv').config();[cite: 1]
const crypto = require('crypto');[cite: 1]
const express = require('express');[cite: 1]
const mongoose = require('mongoose');[cite: 1]
const cors = require('cors');[cite: 1]
const multer = require('multer');[cite: 1]
const path = require('path');[cite: 1]
const fs = require('fs');[cite: 1]
const bcrypt = require('bcryptjs');[cite: 1]
const jwt = require('jsonwebtoken');[cite: 1]
const { Resend } = require('resend');[cite: 1]
const twilio = require('twilio');[cite: 1]

// Initialize Resend & Twilio
const resend = new Resend(process.env.RESEND_API_KEY);[cite: 1]
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);[cite: 1]

// Models
const Homestay = require('./models/Homestay');[cite: 1]
const Ticket = require('./models/Ticket');[cite: 1]
const User = require('./models/User');[cite: 1]
const Booking = require('./models/Booking');[cite: 1]
const Message = require('./models/message');[cite: 1]

const app = express();[cite: 1]

// CORS Configuration
const allowedOrigins = [[cite: 1]
    'https://stayguwahati.in',[cite: 1]
    'https://www.stayguwahati.in',[cite: 1]
    'https://stayguwahati-backend.onrender.com',[cite: 1]
    'http://localhost:3000',[cite: 1]
    'http://localhost:5000',[cite: 1]
    'http://localhost:5173',[cite: 1]
    'http://localhost:5500',[cite: 1]
    'http://127.0.0.1:5500'[cite: 1]
];

app.use(cors({[cite: 1]
    origin: function (origin, callback) {[cite: 1]
        if (!origin) return callback(null, true);[cite: 1]
        if (allowedOrigins.includes(origin)) {[cite: 1]
            return callback(null, true);[cite: 1]
        } else {
            return callback(null, false);[cite: 1]
        }
    },
    credentials: true,[cite: 1]
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],[cite: 1]
    allowedHeaders: ['Content-Type', 'Authorization'][cite: 1]
}));

app.use(express.json({ limit: '50mb' }));[cite: 1]
app.use(express.urlencoded({ limit: '50mb', extended: true }));[cite: 1]

// Ensure uploads folder exists dynamically
const uploadDir = path.join(__dirname, 'uploads');[cite: 1]
if (!fs.existsSync(uploadDir)) {[cite: 1]
    fs.mkdirSync(uploadDir, { recursive: true });[cite: 1]
}

// Expose static files
app.use('/uploads', express.static(uploadDir));[cite: 1]

// --- MULTER STORAGE SETUP ---
const storage = multer.diskStorage({[cite: 1]
    destination: (req, file, cb) => {[cite: 1]
        cb(null, uploadDir);[cite: 1]
    },
    filename: (req, file, cb) => {[cite: 1]
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));[cite: 1]
    }
});

const fileFilter = (req, file, cb) => {[cite: 1]
    if (file.mimetype.startsWith('image/')) {[cite: 1]
        cb(null, true);[cite: 1]
    } else {
        cb(new Error('Only image files (JPG, PNG, WebP) are allowed!'), false);[cite: 1]
    }
};

const upload = multer({[cite: 1]
    storage: storage,[cite: 1]
    fileFilter: fileFilter,[cite: 1]
    limits: { fileSize: 5 * 1024 * 1024 }[cite: 1]
});

// Database Connection
mongoose.connect(process.env.MONGODB_URI)[cite: 1]
    .then(() => console.log('Connected securely to MongoDB Atlas Instance.'))[cite: 1]
    .catch(err => console.error('❌ DATABASE CONNECTION CRASHED!', err.message));[cite: 1]

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {[cite: 1]
    const authHeader = req.headers['authorization'];[cite: 1]
    const token = authHeader && authHeader.split(' ')[1];[cite: 1]

    if (!token) {[cite: 1]
        return res.status(401).json({ success: false, message: 'Access denied. Token missing.' });[cite: 1]
    }

    const jwtSecret = process.env.JWT_SECRET || 'stayguwahati_jwt_super_secret_key_2026';[cite: 1]

    jwt.verify(token, jwtSecret, (err, user) => {[cite: 1]
        if (err) {[cite: 1]
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });[cite: 1]
        }
        req.user = user;[cite: 1]
        next();[cite: 1]
    });
};

// --- API ROUTES ---

// 1. Support Ticket Route
app.post('/api/tickets', async (req, res) => {[cite: 1]
    try {
        const { subject, description, category } = req.body;[cite: 1]
        if (!subject || !description) {[cite: 1]
            return res.status(400).json({ success: false, message: 'Subject and description are required.' });[cite: 1]
        }

        const newTicket = new Ticket({ subject, description, category });[cite: 1]
        await newTicket.save();[cite: 1]

        await resend.emails.send({[cite: 1]
            from: process.env.FROM_EMAIL || 'onboarding@resend.dev',[cite: 1]
            to: process.env.EMAIL_USER,[cite: 1]
            subject: `New Support Ticket: ${subject}`,[cite: 1]
            text: `You have a new support request:\n\nCategory: ${category}\nDescription: ${description}`[cite: 1]
        });

        res.status(200).json({ success: true, message: 'Ticket saved and email sent!' });[cite: 1]
    } catch (err) {
        console.error("Ticket route error:", err);[cite: 1]
        res.status(500).json({ success: false, message: 'Failed to process ticket.' });[cite: 1]
    }
});

// 2. Authentication: Login
app.post('/api/auth/login', async (req, res) => {[cite: 1]
    const { email, password } = req.body;[cite: 1]
    try {
        if (!email || !password) {[cite: 1]
            return res.status(400).json({ success: false, message: "Email and password are required." });[cite: 1]
        }

        const user = await User.findOne({ email: email.toLowerCase() });[cite: 1]
        if (!user) return res.status(400).json({ success: false, message: "Invalid credentials." });[cite: 1]

        const isMatch = await bcrypt.compare(password, user.passwordHash);[cite: 1]
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials." });[cite: 1]

        const jwtSecret = process.env.JWT_SECRET || 'stayguwahati_jwt_super_secret_key_2026';[cite: 1]

        const token = jwt.sign([cite: 1]
            { userId: user._id, email: user.email, role: user.role },[cite: 1]
            jwtSecret,[cite: 1]
            { expiresIn: '7d' }[cite: 1]
        );

        res.status(200).json({[cite: 1]
            success: true,[cite: 1]
            token: token,[cite: 1]
            user: {[cite: 1]
                id: user._id,[cite: 1]
                name: user.name,[cite: 1]
                email: user.email,[cite: 1]
                role: user.role[cite: 1]
            }
        });
    } catch (error) {
        console.error("Login error:", error);[cite: 1]
        res.status(500).json({ success: false, message: error.message || "Auth error." });[cite: 1]
    }
});

// 3. Authentication: Register
app.post('/api/auth/register', async (req, res) => {[cite: 1]
    const { name, email, password } = req.body;[cite: 1]
    try {
        if (!email || !password || !name) {[cite: 1]
            return res.status(400).json({ success: false, message: "Name, email, and password are required." });[cite: 1]
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });[cite: 1]
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists." });[cite: 1]

        const salt = await bcrypt.genSalt(10);[cite: 1]
        const passwordHash = await bcrypt.hash(password, salt);[cite: 1]

        await User.create({ name, email: email.toLowerCase(), passwordHash });[cite: 1]
        res.status(201).json({ success: true, message: "Registration successful!" });[cite: 1]
    } catch (error) {
        console.error("Register error:", error);[cite: 1]
        res.status(500).json({ success: false, message: "Server error." });[cite: 1]
    }
});

// 3.5 Authentication: Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {[cite: 1]
    try {
        const { email } = req.body;[cite: 1]
        if (!email) {[cite: 1]
            return res.status(400).json({ success: false, message: "Email is required." });[cite: 1]
        }

        console.log(`[RESET] Password reset requested for: ${email}`);[cite: 1]

        const user = await User.findOne({ email: email.toLowerCase() });[cite: 1]
        
        if (!user) {[cite: 1]
            console.log(`[RESET] ❌ Email ${email} not found in database.`);[cite: 1]
            return res.status(200).json({ success: true, message: "If your email is registered, a reset link has been sent." });[cite: 1]
        }

        console.log(`[RESET] ✅ User found. Generating token...`);[cite: 1]
        const resetToken = crypto.randomBytes(32).toString('hex');[cite: 1]
        user.resetToken = resetToken;[cite: 1]
        user.resetTokenExpiry = Date.now() + 3600000; // 1 hour validity[cite: 1]
        await user.save();[cite: 1]

        const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';[cite: 1]
        const resetLink = `${clientUrl}/reset-password.html?token=${resetToken}`;[cite: 1]

        const emailResult = await resend.emails.send({[cite: 1]
            from: process.env.FROM_EMAIL || 'onboarding@resend.dev',[cite: 1]
            to: user.email,[cite: 1]
            subject: 'Password Reset Request - StayGuwahati',[cite: 1]
            html: `<h3>Password Reset</h3><p>Click the link below to reset your password (valid for 1 hour):</p><a href="${resetLink}">${resetLink}</a>`[cite: 1]
        });

        console.log(`[RESET] ✉️ Resend API Response:`, emailResult);[cite: 1]
        res.status(200).json({ success: true, message: "Reset link sent to your email!" });[cite: 1]
    } catch (error) {
        console.error("[RESET] ❌ Error during password reset:", error);[cite: 1]
        res.status(500).json({ success: false, message: "Server error during password reset." });[cite: 1]
    }
});

// 3.6 Authentication: Reset Password Complete
app.post('/api/auth/reset-password', async (req, res) => {[cite: 1]
    try {
        const { token, newPassword } = req.body;[cite: 1]

        if (!token || !newPassword) {[cite: 1]
            return res.status(400).json({ success: false, message: "Reset token and new password are required." });[cite: 1]
        }

        const user = await User.findOne({[cite: 1]
            resetToken: token,[cite: 1]
            resetTokenExpiry: { $gt: Date.now() }[cite: 1]
        });

        if (!user) {[cite: 1]
            return res.status(400).json({ success: false, message: "Invalid or expired reset token." });[cite: 1]
        }

        const salt = await bcrypt.genSalt(10);[cite: 1]
        user.passwordHash = await bcrypt.hash(newPassword, salt);[cite: 1]
        user.resetToken = undefined;[cite: 1]
        user.resetTokenExpiry = undefined;[cite: 1]
        await user.save();[cite: 1]

        res.status(200).json({ success: true, message: "Password reset successful! You can now log in." });[cite: 1]
    } catch (error) {
        console.error("Reset password error:", error);[cite: 1]
        res.status(500).json({ success: false, message: "Server error during password reset." });[cite: 1]
    }
});

// 4. Booking Routes
app.get('/api/bookings', async (req, res) => {[cite: 1]
    try {
        const { email } = req.query;[cite: 1]
        let query = {};[cite: 1]

        if (email) {[cite: 1]
            query = {[cite: 1]
                $or: [[cite: 1]
                    { email: email.toLowerCase() },[cite: 1]
                    { hostEmail: email.toLowerCase() }[cite: 1]
                ]
            };
        }

        const bookings = await Booking.find(query).populate('homestayId');[cite: 1]
        res.json({ success: true, data: bookings });[cite: 1]
    } catch (err) {
        console.error("Fetch bookings error:", err);[cite: 1]
        res.status(500).json({ success: false, message: "Error loading bookings" });[cite: 1]
    }
});

app.post('/api/bookings', async (req, res) => {[cite: 1]
    try {
        const {[cite: 1]
            firstName,[cite: 1]
            lastName,[cite: 1]
            email,[cite: 1]
            phone,[cite: 1]
            propertyName,[cite: 1]
            dates,[cite: 1]
            homestayId,[cite: 1]
            checkIn,[cite: 1]
            checkOut,[cite: 1]
            nights,[cite: 1]
            totalPrice[cite: 1]
        } = req.body;[cite: 1]

        if (!firstName || !lastName || !email || !phone) {[cite: 1]
            return res.status(400).json({[cite: 1]
                success: false,[cite: 1]
                message: "First name, last name, email, and phone number are required."[cite: 1]
            });
        }

        if (!homestayId || homestayId === 'unknown' || !mongoose.Types.ObjectId.isValid(homestayId)) {[cite: 1]
            return res.status(400).json({[cite: 1]
                success: false,[cite: 1]
                message: "A valid Homestay ID is required to complete a booking."[cite: 1]
            });
        }

        const validHomestayId = new mongoose.Types.ObjectId(homestayId);[cite: 1]

        const property = await Homestay.findById(validHomestayId);[cite: 1]
        if (!property) {[cite: 1]
            return res.status(444).json({ success: false, message: "Property not found." });[cite: 1]
        }

        const targetEmail = property.ownerEmail || (property.host && property.host.email) || '';[cite: 1]
        const propertyAddress = property.address || property.locality || property.location || 'Guwahati, Assam';[cite: 1]
        let googleMapsUrl = property.mapUrl || property.googleMapsLink || '';[cite: 1]

        let parsedCheckIn = checkIn ? new Date(checkIn) : null;[cite: 1]
        let parsedCheckOut = checkOut ? new Date(checkOut) : null;[cite: 1]

        if ((!parsedCheckIn || isNaN(parsedCheckIn)) && dates && dates.includes('to')) {[cite: 1]
            const parts = dates.split('to').map(s => s.trim());[cite: 1]
            parsedCheckIn = new Date(parts[0]);[cite: 1]
            parsedCheckOut = new Date(parts[1]);[cite: 1]
        }

        if (!parsedCheckIn || isNaN(parsedCheckIn) || !parsedCheckOut || isNaN(parsedCheckOut)) {[cite: 1]
            return res.status(400).json({[cite: 1]
                success: false,[cite: 1]
                message: "Valid check-in and check-out dates are required."[cite: 1]
            });
        }

        const existingBooking = await Booking.findOne({[cite: 1]
            $or: [[cite: 1]
                { homestayId: validHomestayId },[cite: 1]
                { propertyId: validHomestayId }[cite: 1]
            ],
            status: { $nin: ['cancelled', 'rejected'] },[cite: 1]
            checkInDate: { $lt: parsedCheckOut },[cite: 1]
            checkOutDate: { $gt: parsedCheckIn }[cite: 1]
        });

        if (existingBooking) {[cite: 1]
            return res.status(400).json({[cite: 1]
                success: false,[cite: 1]
                message: "These dates are no longer available for this property. Please choose different dates."[cite: 1]
            });
        }

        const formattedDates = dates || `${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]}`;[cite: 1]
        const formattedPropertyName = propertyName || property.title || 'Homestay';[cite: 1]

        if (!googleMapsUrl) {[cite: 1]
            const searchQuery = encodeURIComponent(`${formattedPropertyName} ${propertyAddress}`);[cite: 1]
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`;[cite: 1]
        }

        const newBooking = new Booking({[cite: 1]
            firstName,[cite: 1]
            lastName,[cite: 1]
            email: email.toLowerCase(),[cite: 1]
            phone,[cite: 1]
            userId: req.body.userId || null,[cite: 1]
            propertyId: validHomestayId,[cite: 1]
            homestayId: validHomestayId,[cite: 1]
            propertyName: formattedPropertyName,[cite: 1]
            dates: formattedDates,[cite: 1]
            checkInDate: parsedCheckIn,[cite: 1]
            checkOutDate: parsedCheckOut,[cite: 1]
            hostEmail: targetEmail,[cite: 1]
            nights: nights || 1,[cite: 1]
            totalPrice: totalPrice || 0,[cite: 1]
            status: req.body.status || 'Confirmed'[cite: 1]
        });
        
        await newBooking.save();[cite: 1]

        const emailPromises = [];[cite: 1]

        if (email) {[cite: 1]
            const backendHost = process.env.BACKEND_URL || 'https://stayguwahati-backend.onrender.com';[cite: 1]
            const cleanHost = backendHost.replace(/\/$/, '').replace(/^http:\/\//i, 'https://');[cite: 1]

            let propertyImageUrl = `${cleanHost}/api/homestays/${validHomestayId}/image`;[cite: 1]

            let rawImage = null;[cite: 1]
            if (Array.isArray(property.images) && property.images.length > 0) {[cite: 1]
                rawImage = property.images[0];[cite: 1]
            } else if (Array.isArray(property.photos) && property.photos.length > 0) {[cite: 1]
                rawImage = property.photos[0];[cite: 1]
            } else {
                rawImage = property.imageUrl || property.image || property.coverImage;[cite: 1]
            }

            if (typeof rawImage === 'object' && rawImage !== null) {[cite: 1]
                rawImage = rawImage.url || rawImage.path || rawImage.secure_url || '';[cite: 1]
            }

            if (typeof rawImage === 'string' && rawImage.trim() !== '') {[cite: 1]
                const trimmedImg = rawImage.trim();[cite: 1]

                if (trimmedImg.startsWith('data:image/')) {[cite: 1]
                    propertyImageUrl = `${cleanHost}/api/homestays/${validHomestayId}/image`;[cite: 1]
                } else if (trimmedImg.startsWith('http://') || trimmedImg.startsWith('https://')) {[cite: 1]
                    propertyImageUrl = trimmedImg.replace(/^http:\/\//i, 'https://');[cite: 1]
                } else {
                    const cleanPath = trimmedImg.startsWith('/') ? trimmedImg : `/${trimmedImg}`;[cite: 1]
                    propertyImageUrl = `${cleanHost}${cleanPath}`;[cite: 1]
                }
            }

            const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(propertyAddress)}&zoom=14&size=600x200&maptype=roadmap&markers=color:red%7CLabel:S%7C${encodeURIComponent(propertyAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY || ''}`;[cite: 1]

            emailPromises.push([cite: 1]
                resend.emails.send({[cite: 1]
                    from: process.env.FROM_EMAIL || 'StayGuwahati <onboarding@resend.dev>',[cite: 1]
                    to: email.toLowerCase(),[cite: 1]
                    subject: `Booking Confirmed: ${formattedPropertyName}`,[cite: 1]
                    html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px 10px;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                            
                            <div style="background-color: #0d9488; padding: 20px 24px; text-align: center;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">StayGuwahati</h1>
                            </div>

                            <div style="padding: 28px 24px;">
                                <div style="display: inline-block; background-color: #ccfbf1; color: #0f766e; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 13px; margin-bottom: 12px;">
                                    ✓ Booking Confirmed
                                </div>
                                
                                <h2 style="color: #0f172a; margin: 0 0 6px 0; font-size: 22px;">Hi ${firstName} ${lastName},</h2>
                                <p style="color: #475569; margin: 0 0 20px 0; font-size: 15px; line-height: 1.5;">
                                    Your reservation for <strong>${formattedPropertyName}</strong> is all set!
                                </p>

                                <div style="border-radius: 10px; overflow: hidden; margin-bottom: 20px; border: 1px solid #e2e8f0; background-color: #f8fafc;">
                                    <img src="${propertyImageUrl}" 
                                         alt="${formattedPropertyName}" 
                                         style="width: 100%; height: 220px; object-fit: cover; display: block; border: 0;" />
                                    <div style="padding: 12px 16px; background-color: #ffffff; border-top: 1px solid #f1f5f9;">
                                        <h3 style="margin: 0; font-size: 17px; color: #0f172a; font-weight: 700;">${formattedPropertyName}</h3>
                                        <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">📍 ${propertyAddress}</p>
                                    </div>
                                </div>

                                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin-bottom: 20px;">
                                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
                                        <tr>
                                            <td style="padding: 6px 0; font-weight: 600; color: #64748b; width: 35%;">Dates</td>
                                            <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${formattedDates}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Nights</td>
                                            <td style="padding: 6px 0; font-weight: 500;">${nights || 1} ${nights === 1 ? 'night' : 'nights'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Total Amount</td>
                                            <td style="padding: 6px 0; font-weight: 700; color: #0d9488; font-size: 16px;">₹${totalPrice || 0}</td>
                                        </tr>
                                    </table>
                                </div>

                                <div style="border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; margin-bottom: 24px; background-color: #f1f5f9;">
                                    <a href="${googleMapsUrl}" target="_blank" style="text-decoration: none; display: block;">
                                        <img src="${process.env.GOOGLE_MAPS_API_KEY ? staticMapUrl : 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=600&h=180&q=80'}" 
                                             alt="Property Map Location" 
                                             style="width: 100%; max-height: 180px; object-fit: cover; border: 0; display: block;" />
                                        <div style="padding: 12px; background-color: #ffffff; color: #0d9488; font-weight: 600; font-size: 14px; border-top: 1px solid #e2e8f0; text-align: center;">
                                            📍 Click to Open Google Maps Directions
                                        </div>
                                    </a>
                                </div>

                                <div style="text-align: center; margin-bottom: 24px;">
                                    <a href="${googleMapsUrl}" target="_blank" style="background-color: #0d9488; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 15px;">
                                        Get Directions to Property
                                    </a>
                                </div>

                                <p style="color: #94a3b8; font-size: 13px; line-height: 1.4; margin: 0; text-align: center;">
                                    Need help? Reply to this email or reach us at <a href="mailto:support@stayguwahati.in" style="color: #0d9488; text-decoration: none;">support@stayguwahati.in</a>
                                </p>
                            </div>

                            <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                                <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} StayGuwahati. All rights reserved.</p>
                            </div>

                        </div>
                    </body>
                    </html>
                    `
                }).catch(err => console.error("Guest email dispatch error:", err.message))[cite: 1]
            );
        }

        if (targetEmail) {[cite: 1]
            emailPromises.push([cite: 1]
                resend.emails.send({[cite: 1]
                    from: process.env.FROM_EMAIL || 'onboarding@resend.dev',[cite: 1]
                    to: targetEmail, 
                    subject: 'New Booking Request for ' + formattedPropertyName,[cite: 1]
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
                }).catch(err => console.error("Host email dispatch error:", err.message))[cite: 1]
            );
        }

        await Promise.all(emailPromises);[cite: 1]

        return res.status(200).json({[cite: 1]
            success: true,[cite: 1]
            message: "Booking saved and confirmed!",[cite: 1]
            data: newBooking[cite: 1]
        });

    } catch (error) {
        if (error.name === 'ValidationError') {[cite: 1]
            console.error("Mongoose Validation Error:", error.message);[cite: 1]
            return res.status(400).json({ success: false, message: error.message });[cite: 1]
        }

        if (error.code === 11000) {[cite: 1]
            return res.status(400).json({[cite: 1]
                success: false,[cite: 1]
                message: "This homestay was just booked for these dates. Please pick another date."[cite: 1]
            });
        }

        console.error("Booking route unexpected error:", error);[cite: 1]
        res.status(500).json({ success: false, message: error.message || "Server error during booking." });[cite: 1]
    }
});

// 4.5 Send Message Route (Supports both /api/messages and /api/messages/send)
app.post(['/api/messages', '/api/messages/send'], async (req, res) => {[cite: 1]
    try {
        const { recipientPhone, message, senderName, propertyTitle, guestName, recipient, sender } = req.body;[cite: 1]

        if (!message) {[cite: 1]
            return res.status(400).json({ success: false, error: "Missing required message field." });[cite: 1]
        }

        const finalGuestName = guestName || recipient || 'Valued Guest';[cite: 1]
        const finalPropertyTitle = propertyTitle || 'StayGuwahati Property';[cite: 1]
        const finalSenderName = senderName || sender || 'User';[cite: 1]

        const newMessage = new Message({[cite: 1]
            propertyTitle: finalPropertyTitle,[cite: 1]
            guestName: finalGuestName,[cite: 1]
            senderName: finalSenderName,[cite: 1]
            message,[cite: 1]
            recipientPhone: recipientPhone || ''[cite: 1]
        });
        await newMessage.save();[cite: 1]

        let twilioSid = null;[cite: 1]
        if (recipientPhone && (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER)) {[cite: 1]
            try {
                // 1. Generate direct browser chat link
                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';[cite: 1]
                const encodedGuest = encodeURIComponent(finalGuestName);[cite: 1]
                const encodedProp = encodeURIComponent(finalPropertyTitle);[cite: 1]
                const chatLink = `${clientUrl}/chat.html?guest=${encodedGuest}&property=${encodedProp}`;[cite: 1]

                // 2. Format Phone Number to E.164 (+91 standard)
                let formattedPhone = recipientPhone.trim().replace(/\s+/g, '');[cite: 1]
                if (!formattedPhone.startsWith('+')) {[cite: 1]
                    formattedPhone = `+91${formattedPhone.replace(/^0+/, '')}`;[cite: 1]
                }

                // 3. Clean and sanitize Twilio FROM number
                const rawTwilioNumber = (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim();[cite: 1]
                let fromWhatsAppNumber = rawTwilioNumber.startsWith('whatsapp:')[cite: 1]
                    ? rawTwilioNumber[cite: 1]
                    : `whatsapp:${rawTwilioNumber}`;[cite: 1]

                // 4. Construct WhatsApp message body formatted with Markdown bolding
                const whatsappBody = `*StayGuwahati Update*\n\nMessage from *${finalSenderName}* regarding *${finalPropertyTitle}*:\n"${message}"\n\nReply directly here:\n${chatLink}`;[cite: 1]

                // 5. Dispatch via Twilio WhatsApp API
                const twilioResponse = await twilioClient.messages.create({[cite: 1]
                    body: whatsappBody,[cite: 1]
                    from: fromWhatsAppNumber,[cite: 1]
                    to: `whatsapp:${formattedPhone}`[cite: 1]
                });
                twilioSid = twilioResponse.sid;[cite: 1]
            } catch (twilioErr) {
                console.error("Twilio Dispatch Warning:", twilioErr.message);[cite: 1]
            }
        }

        res.status(200).json({[cite: 1]
            success: true,[cite: 1]
            message: "Message saved and dispatched successfully via WhatsApp.",[cite: 1]
            data: newMessage,[cite: 1]
            sid: twilioSid[cite: 1]
        });

    } catch (error) {
        console.error("Message Saving Error:", error);[cite: 1]
        res.status(500).json({ success: false, error: error.message });[cite: 1]
    }
});

// 4.6 Get Messages Route (Fetches chat history for host & guest frontend)
app.get('/api/messages', async (req, res) => {[cite: 1]
    try {
        const { propertyTitle, guestName, recipientPhone } = req.query;[cite: 1]
        let filter = {};[cite: 1]

        if (propertyTitle) filter.propertyTitle = propertyTitle;[cite: 1]
        if (guestName) filter.guestName = guestName;[cite: 1]
        if (recipientPhone) filter.recipientPhone = recipientPhone;[cite: 1]

        const messages = await Message.find(filter).sort({ createdAt: 1 });[cite: 1]

        res.status(200).json({[cite: 1]
            success: true,[cite: 1]
            data: messages[cite: 1]
        });
    } catch (error) {
        console.error("Fetch Messages Error:", error);[cite: 1]
        res.status(500).json({ success: false, error: error.message });[cite: 1]
    }
});

// 4.7 Twilio Inbound Webhook (Receives WhatsApp replies sent from phone numbers)
app.post('/api/messages/webhook', async (req, res) => {[cite: 1]
    try {
        const { From, Body, ProfileName } = req.body;[cite: 1]

        const senderPhone = From ? From.replace('whatsapp:', '') : '';[cite: 1]

        if (Body) {[cite: 1]
            const incomingMsg = new Message({[cite: 1]
                propertyTitle: 'StayGuwahati Property',[cite: 1]
                guestName: ProfileName || 'WhatsApp User',[cite: 1]
                senderName: ProfileName || senderPhone,[cite: 1]
                message: Body,[cite: 1]
                recipientPhone: senderPhone[cite: 1]
            });
            await incomingMsg.save();[cite: 1]
        }

        res.type('text/xml');[cite: 1]
        res.status(200).send('<Response></Response>');[cite: 1]
    } catch (error) {
        console.error("Twilio Webhook Error:", error);[cite: 1]
        res.status(500).send("Webhook processing error");[cite: 1]
    }
});

// 5. File Upload
app.post('/api/upload-images', (req, res) => {[cite: 1]
    upload.array('photos', 3)(req, res, (err) => {[cite: 1]
        if (err instanceof multer.MulterError) {[cite: 1]
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });[cite: 1]
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });[cite: 1]
        }

        if (!req.files || req.files.length === 0) {[cite: 1]
            return res.status(400).json({ success: false, message: 'No images uploaded.' });[cite: 1]
        }

        const filePaths = req.files.map(file => `/uploads/${file.filename}`);[cite: 1]
        res.status(200).json({ success: true, images: filePaths });[cite: 1]
    });
});

// 6. Homestay Operations
const getHomestaysHandler = async (req, res) => {[cite: 1]
    try {
        const { locality, maxPrice, feature, status } = req.query;[cite: 1]
        let queryFilter = {};[cite: 1]

        if (status) {[cite: 1]
            queryFilter.status = status.toLowerCase();[cite: 1]
        } else {
            queryFilter.status = 'approved';[cite: 1]
        }

        if (locality) queryFilter.locality = locality;[cite: 1]
        if (maxPrice) queryFilter.pricePerNight = { $lte: Number(maxPrice) };[cite: 1]
        if (feature) queryFilter.features = { $in: [feature] };[cite: 1]

        const listings = await Homestay.find(queryFilter).sort({ createdAt: -1 });[cite: 1]
        res.status(200).json({ success: true, count: listings.length, data: listings });[cite: 1]
    } catch (error) {
        console.error("GET homestays error:", error);[cite: 1]
        res.status(500).json({ success: false, message: 'Server Error' });[cite: 1]
    }
};

const getSingleHomestayHandler = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {[cite: 1]
            return res.status(400).json({ success: false, message: "Invalid ID format" });[cite: 1]
        }

        const homestay = await Homestay.findById(req.params.id);[cite: 1]
        if (!homestay) return res.status(404).json({ success: false, message: "Property not found" });[cite: 1]
        
        res.status(200).json({ success: true, data: homestay });[cite: 1]
    } catch (error) {
        console.error("GET single homestay error:", error);[cite: 1]
        res.status(500).json({ success: false, message: 'Server Error' });[cite: 1]
    }
};

app.get('/api/homestays', getHomestaysHandler);[cite: 1]
app.get('/api/properties', getHomestaysHandler);[cite: 1]

app.get('/api/homestays/:id', getSingleHomestayHandler);
app.get('/api/properties/:id', getSingleHomestayHandler);

app.get('/api/homestays/:id/image', async (req, res) => {[cite: 1]
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {[cite: 1]
            return res.status(400).send("Invalid ID format");[cite: 1]
        }

        const homestay = await Homestay.findById(req.params.id);[cite: 1]
        if (!homestay) return res.status(404).send("Property not found");[cite: 1]

        let rawImage = (homestay.images && homestay.images[0]) ||[cite: 1]
                         (homestay.photos && homestay.photos[0]) ||[cite: 1]
                         homestay.imageUrl || homestay.image;[cite: 1]

        if (typeof rawImage === 'object' && rawImage !== null) {[cite: 1]
            rawImage = rawImage.url || rawImage.path || rawImage.secure_url || '';[cite: 1]
        }

        if (typeof rawImage === 'string' && rawImage.startsWith('data:image/')) {[cite: 1]
            const matches = rawImage.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);[cite: 1]
            if (matches) {[cite: 1]
                const contentType = matches[1];[cite: 1]
                const imageBuffer = Buffer.from(matches[2], 'base64');[cite: 1]
                res.setHeader('Content-Type', contentType);[cite: 1]
                res.setHeader('Cache-Control', 'public, max-age=86400');[cite: 1]
                return res.send(imageBuffer);[cite: 1]
            }
        }

        if (typeof rawImage === 'string' && rawImage.trim().length > 0) {[cite: 1]
            const trimmed = rawImage.trim();[cite: 1]
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {[cite: 1]
                return res.redirect(trimmed);[cite: 1]
            }
            const backendHost = process.env.BACKEND_URL || 'https://stayguwahati-backend.onrender.com';[cite: 1]
            const cleanHost = backendHost.replace(/\/$/, '').replace(/^http:\/\//i, 'https://');[cite: 1]
            const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;[cite: 1]
            return res.redirect(`${cleanHost}${cleanPath}`);[cite: 1]
        }

        res.redirect('https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=600&q=80');[cite: 1]
    } catch (err) {
        console.error("Image server error:", err);[cite: 1]
        res.status(500).send("Error loading image");[cite: 1]
    }
});

app.post('/api/homestays', async (req, res) => {[cite: 1]
    try {
        const formattedData = {[cite: 1]
            ...req.body,[cite: 1]
            host: {[cite: 1]
                name: req.body.owner || (req.body.host && req.body.host.name) || "Unknown Host",[cite: 1]
                phone: req.body.phone || (req.body.host && req.body.host.phone) || "",[cite: 1]
                email: req.body.email || (req.body.host && req.body.host.email) || ""[cite: 1]
            },
            status: req.body.status ? req.body.status.toLowerCase() : 'pending'[cite: 1]
        };

        const newStay = await Homestay.create(formattedData);[cite: 1]
        res.status(201).json({ success: true, message: 'Listing created!', data: newStay });[cite: 1]
    } catch (error) {
        console.error("❌ MONGODB VALIDATION/SAVE ERROR:", error.message);[cite: 1]
        res.status(400).json({ success: false, message: 'Validation failed', error: error.message });[cite: 1]
    }
});

// 7. Admin Status Update (Protected by JWT)
app.patch('/api/admin/homestays/:id/status', authenticateToken, async (req, res) => {[cite: 1]
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {[cite: 1]
            return res.status(400).json({ success: false, message: "Invalid Property ID format" });[cite: 1]
        }

        if (!req.body.status) {[cite: 1]
            return res.status(400).json({ success: false, message: "Status is required in request body" });[cite: 1]
        }

        const updatedProperty = await Homestay.findByIdAndUpdate([cite: 1]
            req.params.id,[cite: 1]
            { status: req.body.status.toLowerCase() },[cite: 1]
            { new: true, runValidators: true }[cite: 1]
        );
        
        if (!updatedProperty) return res.status(404).json({ success: false, message: "Property not found." });[cite: 1]
        res.json({ success: true, message: "Status updated!", data: updatedProperty });[cite: 1]
    } catch (err) {
        console.error("Admin status update error:", err);[cite: 1]
        res.status(500).json({ success: false, message: "Server error." });[cite: 1]
    }
});

const PORT = process.env.PORT || 5000;[cite: 1]
app.listen(PORT, () => {[cite: 1]
    console.log(`StayGuwahati Core Engine running on port ${PORT}`);[cite: 1]
});