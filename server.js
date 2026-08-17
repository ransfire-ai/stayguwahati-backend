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
const cron = require('node-cron');

// Initialize Resend & Twilio safely
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

// Models (Fixed casing consistency)
const Homestay = require('./models/Homestay');
const Ticket = require('./models/Ticket');
const User = require('./models/User');
const Booking = require('./models/Booking');
const Message = require('./models/message');
const Review = require('./models/Review');

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
        const isVercel = /\.vercel\.app$/.test(origin);
        if (allowedOrigins.includes(origin) || isVercel) {
            return callback(null, true);
        } else {
            return callback(new Error('Not allowed by CORS'), false);
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
if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI environment variable is missing!');
} else {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => {
            console.log('Connected securely to MongoDB Atlas Instance.');
            initScheduledJobs();
        })
        .catch(err => console.error('❌ DATABASE CONNECTION CRASHED!', err.message));
}

// --- BACKGROUND CRON JOBS ---
function initScheduledJobs() {
    cron.schedule('0 10 * * *', async () => {
        console.log('[CRON] Checking for completed stays to send review follow-up emails...');
        if (!resend) {
            console.warn('[CRON] Resend API key not configured. Skipping email dispatch.');
            return;
        }

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const completedBookings = await Booking.find({
                checkOutDate: { $lt: today },
                reviewEmailSent: { $ne: true },
                status: { $nin: ['cancelled', 'rejected'] }
            });

            for (const booking of completedBookings) {
                if (!booking.reviewToken) {
                    booking.reviewToken = crypto.randomBytes(32).toString('hex');
                }

                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
                const reviewUrl = `${clientUrl}/review?token=${booking.reviewToken}`;

                await resend.emails.send({
                    from: process.env.FROM_EMAIL || 'StayGuwahati <onboarding@resend.dev>',
                    to: booking.email,
                    subject: `How was your stay at ${booking.propertyName}?`,
                    html: `
                        <!DOCTYPE html>
                        <html>
                        <body style="font-family: sans-serif; background-color: #f1f5f9; padding: 20px;">
                            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px;">
                                <h2 style="color: #0f172a;">We hope you enjoyed your stay!</h2>
                                <p style="color: #475569; font-size: 15px;">
                                    Hi ${booking.firstName}, we hope you had a wonderful time at <strong>${booking.propertyName}</strong>. 
                                    We would love to hear about your experience!
                                </p>
                                <div style="text-align: center; margin: 30px 0;">
                                    <a href="${reviewUrl}" style="background-color: #0f766e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
                                        Leave a Review
                                    </a>
                                </div>
                                <p style="color: #94a3b8; font-size: 13px;">Thank you for choosing StayGuwahati.</p>
                            </div>
                        </body>
                        </html>
                    `
                });

                booking.reviewEmailSent = true;
                await booking.save();
                console.log(`[CRON] Review follow-up email sent to ${booking.email}`);
            }
        } catch (error) {
            console.error('[CRON] Error sending review follow-up emails:', error);
        }
    });
}

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

const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    return res.status(403).json({ success: false, message: 'Access denied. Admin rights required.' });
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

        if (resend) {
            await resend.emails.send({
                from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                to: process.env.EMAIL_USER || 'support@stayguwahati.in',
                subject: `New Support Ticket: ${subject}`,
                text: `You have a new support request:\n\nCategory: ${category}\nDescription: ${description}`
            });
        }

        res.status(200).json({ success: true, message: 'Ticket saved and processed successfully!' });
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

        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
            return res.status(200).json({ success: true, message: "If your email is registered, a reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetToken = resetToken;
        user.resetTokenExpiry = Date.now() + 3600000;
        await user.save();

        const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
        const resetLink = `${clientUrl}/reset-password?token=${resetToken}`;

        if (resend) {
            await resend.emails.send({
                from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                to: user.email,
                subject: 'Password Reset Request - StayGuwahati',
                html: `<h3>Password Reset</h3><p>Click the link below to reset your password (valid for 1 hour):</p><a href="${resetLink}">${resetLink}</a>`
            });
        }

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
        let {
            firstName,
            lastName,
            email,
            phone,
            guestInfo,
            propertyName,
            dates,
            homestayId,
            propertyId,
            checkIn,
            checkOut,
            nights,
            totalPrice,
            totalAmount
        } = req.body;

        // --- 1. Robust Guest Info Parsing ---
        if (guestInfo) {
            if (!email && guestInfo.email) email = guestInfo.email;
            if (!phone && guestInfo.phone) phone = guestInfo.phone;
            if (!firstName && !lastName && guestInfo.fullName) {
                const parts = guestInfo.fullName.trim().split(' ');
                firstName = parts[0] || 'Valued';
                lastName = parts.slice(1).join(' ') || 'Guest';
            }
        }

        if ((!firstName || !lastName) && req.body.fullName) {
            const parts = req.body.fullName.trim().split(' ');
            firstName = firstName || parts[0] || 'Valued';
            lastName = lastName || parts.slice(1).join(' ') || 'Guest';
        }

        firstName = firstName || 'Valued';
        lastName = lastName || 'Guest';
        email = email || 'guest@stayguwahati.in';
        phone = phone || '9876543210';

        // --- 2. Flexible Property & ID Resolution ---
        let targetHomestayId = homestayId || propertyId || req.body.id;
        let property = null;

        if (targetHomestayId && mongoose.Types.ObjectId.isValid(targetHomestayId)) {
            property = await Homestay.findById(targetHomestayId);
        }

        if (!property) {
            property = await Homestay.findOne({});
        }

        if (!property) {
            property = await Homestay.create({
                title: propertyName || 'Green Villa',
                locality: 'Guwahati',
                pricePerNight: 1500,
                status: 'approved',
                ownerEmail: email
            });
        }

        const validHomestayId = property._id;
        const targetEmail = property.ownerEmail || (property.host && property.host.email) || email;
        const propertyAddress = property.address || property.locality || 'Guwahati, Assam';
        let googleMapsUrl = property.mapUrl || property.googleMapsLink || '';

        // --- 3. Date & Pricing Normalization ---
        let parsedCheckIn = checkIn ? new Date(checkIn) : new Date();
        let parsedCheckOut = checkOut ? new Date(checkOut) : new Date(Date.now() + 86400000);

        if ((!checkIn || isNaN(parsedCheckIn.getTime())) && dates && dates.includes('to')) {
            const parts = dates.split('to').map(s => s.trim());
            const d1 = new Date(parts[0]);
            const d2 = new Date(parts[1]);
            if (!isNaN(d1.getTime())) parsedCheckIn = d1;
            if (!isNaN(d2.getTime())) parsedCheckOut = d2;
        }

        if (isNaN(parsedCheckIn.getTime())) parsedCheckIn = new Date();
        if (isNaN(parsedCheckOut.getTime()) || parsedCheckOut <= parsedCheckIn) {
            parsedCheckOut = new Date(parsedCheckIn.getTime() + 86400000);
        }

        const formattedDates = dates || `${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]}`;
        const formattedPropertyName = propertyName || property.title || property.propertyName || 'Green Villa';
        const finalTotalPrice = totalPrice !== undefined ? totalPrice : (totalAmount !== undefined ? totalAmount : (property.pricePerNight || 1500));

        if (!googleMapsUrl) {
            const searchQuery = encodeURIComponent(`${formattedPropertyName} ${propertyAddress}`);
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`;
        }

        const reviewToken = crypto.randomBytes(32).toString('hex');

        // --- 4. Save Booking ---
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
            totalPrice: finalTotalPrice,
            status: req.body.status || 'Confirmed',
            reviewToken,
            reviewSubmitted: false,
            reviewEmailSent: false
        });
        
        await newBooking.save();

        // --- 5. Async Email Dispatch (Non-blocking) ---
        if (resend) {
            const emailPromises = [];

            if (email) {
                const backendHost = process.env.BACKEND_URL || 'https://stayguwahati-backend.onrender.com';
                const cleanHost = backendHost.replace(/\/$/, '').replace(/^http:\/\//i, 'https://');

                let propertyImageUrl = `${cleanHost}/api/homestays/${validHomestayId}/image`;

                let rawImage = null;
                if (Array.isArray(property.images) && property.images.length > 0) {
                    rawImage = property.images[0];
                } else if (Array.isArray(property.photos) && property.photos.length > 0) {
                    rawImage = property.photos[0];
                } else {
                    rawImage = property.imageUrl || property.image || property.coverImage;
                }

                if (typeof rawImage === 'object' && rawImage !== null) {
                    rawImage = rawImage.url || rawImage.path || rawImage.secure_url || '';
                }

                if (typeof rawImage === 'string' && rawImage.trim() !== '') {
                    const trimmedImg = rawImage.trim();

                    if (trimmedImg.startsWith('data:image/')) {
                        propertyImageUrl = `${cleanHost}/api/homestays/${validHomestayId}/image`;
                    } else if (trimmedImg.startsWith('http://') || trimmedImg.startsWith('https://')) {
                        propertyImageUrl = trimmedImg.replace(/^http:\/\//i, 'https://');
                    } else {
                        const cleanPath = trimmedImg.startsWith('/') ? trimmedImg : `/${trimmedImg}`;
                        propertyImageUrl = `${cleanHost}${cleanPath}`;
                    }
                }

                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
                const reviewUrl = `${clientUrl}/review?token=${reviewToken}`;

                emailPromises.push(
                    resend.emails.send({
                        from: process.env.FROM_EMAIL || 'StayGuwahati <onboarding@resend.dev>',
                        to: email.toLowerCase(),
                        subject: `Booking Confirmed: ${formattedPropertyName}`,
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
                                        <img src="${propertyImageUrl}" alt="${formattedPropertyName}" style="width: 100%; height: 220px; object-fit: cover; display: block; border: 0;" />
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
                                                <td style="padding: 6px 0; font-weight: 700; color: #0d9488; font-size: 16px;">₹${finalTotalPrice}</td>
                                            </tr>
                                        </table>
                                    </div>
                                    <div style="text-align: center; margin-bottom: 24px;">
                                        <a href="${googleMapsUrl}" target="_blank" style="background-color: #0d9488; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 15px;">Get Directions to Property</a>
                                    </div>
                                    <div style="text-align: center; margin-bottom: 24px;">
                                        <a href="${reviewUrl}" style="background-color: #0f766e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 14px;">Leave a Review After Your Stay</a>
                                    </div>
                                </div>
                            </div>
                        </body>
                        </html>
                        `
                    }).catch(err => console.error("Guest email dispatch error:", err.message))
                );
            }

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
                                    <li><strong>Total Amount:</strong> ₹${finalTotalPrice}</li>
                                </ul>
                            </div>
                        `
                    }).catch(err => console.error("Host email dispatch error:", err.message))
                );
            }

            await Promise.all(emailPromises);
        }

        return res.status(200).json({
            success: true,
            message: "Booking saved and confirmed!",
            data: newBooking
        });

    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "This homestay was just booked for these dates. Please pick another date."
            });
        }

        res.status(500).json({ success: false, message: error.message || "Server error during booking." });
    }
});

// 4.1 Update / Cancel Booking Status
app.patch('/api/bookings/:id/status', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Booking ID" });
        }

        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, message: "Status field is required." });
        }

        const updatedBooking = await Booking.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );

        if (!updatedBooking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        res.status(200).json({ success: true, message: "Booking status updated", data: updatedBooking });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// 4.2 Get Reviews Route
app.get('/api/reviews', async (req, res) => {
    try {
        const { propertyId } = req.query;
        let filter = {};

        if (propertyId) {
            const cleanPropertyId = propertyId.toString().trim();
            
            if (mongoose.Types.ObjectId.isValid(cleanPropertyId)) {
                filter.propertyId = {
                    $in: [cleanPropertyId, new mongoose.Types.ObjectId(cleanPropertyId)]
                };
            } else {
                filter.propertyId = cleanPropertyId;
            }
        }

        const reviews = await Review.find(filter).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: reviews.length,
            data: reviews
        });
    } catch (error) {
        console.error("Fetch reviews error:", error);
        res.status(500).json({ success: false, message: "Error fetching reviews." });
    }
});
// 4.3 Post-Stay Review Submission Route
app.post('/api/reviews', async (req, res) => {
    try {
        const { token, rating, comment, guestName } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, message: "Review token is missing." });
        }

        if (!rating) {
            return res.status(400).json({ success: false, message: "A rating is required to submit a review." });
        }

        const booking = await Booking.findOne({ reviewToken: token });
        if (!booking) {
            return res.status(400).json({ success: false, message: "Invalid or expired review token." });
        }

        if (booking.reviewSubmitted) {
            return res.status(400).json({ success: false, message: "A review has already been submitted for this booking." });
        }

        const newReview = new Review({
            propertyId: booking.propertyId || booking.homestayId,
            bookingId: booking._id,
            guestName: guestName || `${booking.firstName} ${booking.lastName}`.trim() || 'Verified Guest',
            rating: Number(rating),
            comment: comment || ''
        });

        await newReview.save();

        booking.reviewSubmitted = true;
        booking.reviewToken = undefined;
        await booking.save();

        res.status(200).json({ 
            success: true, 
            message: "Thank you! Your verified review has been submitted successfully.",
            data: newReview
        });
    } catch (error) {
        console.error("Review submission error:", error);
        res.status(500).json({ success: false, message: "Server error during review submission." });
    }
});

// 4.5 Send Message Route
app.post(['/api/messages', '/api/messages/send'], async (req, res) => {
    try {
        const { recipientPhone, message, senderName, propertyTitle, guestName, recipient, sender } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, error: "Missing required message field." });
        }

        const finalGuestName = guestName || recipient || 'Valued Guest';
        const finalPropertyTitle = propertyTitle || 'StayGuwahati Property';
        const finalSenderName = senderName || sender || 'User';

        const newMessage = new Message({
            propertyTitle: finalPropertyTitle,
            guestName: finalGuestName,
            senderName: finalSenderName,
            message,
            recipientPhone: recipientPhone || ''
        });
        await newMessage.save();

        let twilioSid = null;
        if (twilioClient && recipientPhone && (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER)) {
            try {
                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
                const encodedGuest = encodeURIComponent(finalGuestName);
                const encodedProp = encodeURIComponent(finalPropertyTitle);
                
                const chatLink = `${clientUrl}/chat?guest=${encodedGuest}&property=${encodedProp}`;

                let formattedPhone = recipientPhone.trim().replace(/\s+/g, '');
                if (!formattedPhone.startsWith('+')) {
                    formattedPhone = `+91${formattedPhone.replace(/^0+/, '')}`;
                }

                const rawTwilioNumber = (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim();
                let fromWhatsAppNumber = rawTwilioNumber.startsWith('whatsapp:')
                    ? rawTwilioNumber
                    : `whatsapp:${rawTwilioNumber}`;

                const whatsappBody = `*StayGuwahati Update*\n\nMessage from *${finalSenderName}* regarding *${finalPropertyTitle}*:\n"${message}"\n\nReply directly here:\n${chatLink}`;

                const twilioResponse = await twilioClient.messages.create({
                    body: whatsappBody,
                    from: fromWhatsAppNumber,
                    to: `whatsapp:${formattedPhone}`
                });
                twilioSid = twilioResponse.sid;
            } catch (twilioErr) {
                console.error("Twilio Dispatch Warning:", twilioErr.message);
            }
        }

        res.status(200).json({
            success: true,
            message: "Message saved and dispatched successfully via WhatsApp.",
            data: newMessage,
            sid: twilioSid
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4.6 Get Messages Route
app.get('/api/messages', async (req, res) => {
    try {
        const { propertyTitle, guestName, recipientPhone } = req.query;
        let filter = {};

        if (propertyTitle) filter.propertyTitle = propertyTitle;
        if (guestName) filter.guestName = guestName;
        if (recipientPhone) filter.recipientPhone = recipientPhone;

        const messages = await Message.find(filter).sort({ createdAt: 1 });

        res.status(200).json({
            success: true,
            data: messages
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4.7 Twilio Inbound Webhook
app.post('/api/messages/webhook', async (req, res) => {
    try {
        const { From, Body, ProfileName } = req.body;
        const senderPhone = From ? From.replace('whatsapp:', '') : '';

        if (Body) {
            const incomingMsg = new Message({
                propertyTitle: 'StayGuwahati Property',
                guestName: ProfileName || 'WhatsApp User',
                senderName: ProfileName || senderPhone,
                message: Body,
                recipientPhone: senderPhone
            });
            await incomingMsg.save();
        }

        res.type('text/xml');
        res.status(200).send('<Response></Response>');
    } catch (error) {
        res.status(500).send("Webhook processing error");
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
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const getSingleHomestayHandler = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid ID format" });
        }

        const homestay = await Homestay.findById(req.params.id);
        if (!homestay) return res.status(404).json({ success: false, message: "Property not found" });
        
        res.status(200).json({ success: true, data: homestay });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

app.get('/api/homestays', getHomestaysHandler);
app.get('/api/properties', getHomestaysHandler);

app.get('/api/homestays/:id', getSingleHomestayHandler);
app.get('/api/properties/:id', getSingleHomestayHandler);

app.get('/api/homestays/:id/image', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).send("Invalid ID format");
        }

        const homestay = await Homestay.findById(req.params.id);
        if (!homestay) return res.status(404).send("Property not found");

        let rawImage = (homestay.images && homestay.images[0]) ||
                         (homestay.photos && homestay.photos[0]) ||
                         homestay.imageUrl || homestay.image;

        if (typeof rawImage === 'object' && rawImage !== null) {
            rawImage = rawImage.url || rawImage.path || rawImage.secure_url || '';
        }

        if (typeof rawImage === 'string' && rawImage.startsWith('data:image/')) {
            const matches = rawImage.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (matches) {
                const contentType = matches[1];
                const imageBuffer = Buffer.from(matches[2], 'base64');
                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(imageBuffer);
            }
        }

        if (typeof rawImage === 'string' && rawImage.trim().length > 0) {
            const trimmed = rawImage.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                return res.redirect(trimmed);
            }
            const backendHost = process.env.BACKEND_URL || 'https://stayguwahati-backend.onrender.com';
            const cleanHost = backendHost.replace(/\/$/, '').replace(/^http:\/\//i, 'https://');
            const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
            return res.redirect(`${cleanHost}${cleanPath}`);
        }

        res.redirect('https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=600&q=80');
    } catch (err) {
        res.status(500).send("Error loading image");
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
        res.status(400).json({ success: false, message: 'Validation failed', error: error.message });
    }
});

app.put('/api/homestays/:id', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Property ID format" });
        }

        const updatedProperty = await Homestay.findByIdAndUpdate(
            req.params.id,
            { ...req.body },
            { new: true, runValidators: true }
        );

        if (!updatedProperty) {
            return res.status(404).json({ success: false, message: "Property not found." });
        }

        res.status(200).json({ success: true, message: "Property updated successfully!", data: updatedProperty });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during update." });
    }
});

app.delete('/api/homestays/:id', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Property ID format" });
        }

        const deletedProperty = await Homestay.findByIdAndDelete(req.params.id);
        if (!deletedProperty) {
            return res.status(404).json({ success: false, message: "Property not found." });
        }

        res.status(200).json({ success: true, message: "Property deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during deletion." });
    }
});

app.patch('/api/admin/homestays/:id/status', authenticateToken, authorizeAdmin, async (req, res) => {
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
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// Centralized Global Error Handler
app.use((err, req, res, next) => {
    console.error("Unhandled Global Error:", err);
    res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`StayGuwahati Core Engine running on port ${PORT}`);
});