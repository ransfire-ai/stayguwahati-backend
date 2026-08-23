require('dotenv').config(); //[cite: 7]
const crypto = require('crypto'); //[cite: 7]
const express = require('express'); //[cite: 7]
const mongoose = require('mongoose'); //[cite: 7]
const cors = require('cors'); //[cite: 7]
const multer = require('multer'); //[cite: 7]
const path = require('path'); //[cite: 7]
const fs = require('fs'); //[cite: 7]
const bcrypt = require('bcryptjs'); //[cite: 7]
const jwt = require('jsonwebtoken'); //[cite: 7]
const { Resend } = require('resend'); //[cite: 7]
const twilio = require('twilio'); //[cite: 7]
const cron = require('node-cron'); //[cite: 7]

// Initialize Resend & Twilio safely[cite: 7]
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null; //[cite: 7]
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) //[cite: 7]
    : null; //[cite: 7]

// Models[cite: 7]
const Homestay = require('./models/Homestay'); //[cite: 7]
const Ticket = require('./models/Ticket'); //[cite: 7]
const User = require('./models/User'); //[cite: 7]
const Booking = require('./models/Booking'); //[cite: 7]
const Message = require('./models/message'); //[cite: 7]
const Review = require('./models/Review'); //[cite: 7]

const app = express(); //[cite: 7]

// CORS Configuration[cite: 7]
const allowedOrigins = [
    'https://stayguwahati.in',
    'https://www.stayguwahati.in',
    'https://stayguwahati-backend.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
]; //[cite: 7]

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
})); //[cite: 7]

// --- INCREASED PAYLOAD LIMITS (100MB) ---
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Ensure uploads folder exists dynamically[cite: 7]
const uploadDir = path.join(__dirname, 'uploads'); //[cite: 7]
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true }); //[cite: 7]
}

// Expose static files[cite: 7]
app.use('/uploads', express.static(uploadDir, {
    fallthrough: true,
    maxAge: '7d',
    etag: true,
    index: false
}));

// Clear diagnostic response for a missing local upload.
// This makes it obvious when an old MongoDB URL points to a file
// that no longer exists on the Render filesystem.
app.get('/uploads/:filename', (req, res, next) => {
    const requestedFile = path.basename(req.params.filename || '');
    const requestedPath = path.join(uploadDir, requestedFile);

    if (fs.existsSync(requestedPath)) {
        return next();
    }

    return res.status(404).type('text').send(
        'Image file not found on this server. ' +
        'If this is an old listing, re-upload the image. ' +
        'For persistent storage, configure Cloudinary.'
    );
}); //[cite: 7]

// --- MULTER STORAGE SETUP ---[cite: 7]
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir); //[cite: 7]
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname)); //[cite: 7]
    }
}); //[cite: 7]

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true); //[cite: 7]
    } else {
        cb(new Error('Only image files (JPG, PNG, WebP) are allowed!'), false); //[cite: 7]
    }
}; //[cite: 7]

// --- INCREASED MULTER FILE & FIELD SIZE LIMITS (50MB) ---
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB per file
        fieldSize: 50 * 1024 * 1024  // 50MB per text field
    }
});

// ============================================================
// CLOUDINARY IMAGE STORAGE (OPTIONAL BUT RECOMMENDED)
// ============================================================
// Add these environment variables on Render to make uploaded
// property images persistent across redeploys/restarts:
//
// CLOUDINARY_CLOUD_NAME
// CLOUDINARY_API_KEY
// CLOUDINARY_API_SECRET
//
// When configured, new uploads are sent to Cloudinary and the
// returned secure URL is saved/returned to the frontend.
// If Cloudinary is not configured, the server falls back to
// the local /uploads folder for backward compatibility.

const cloudinaryConfigured =
    Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
    Boolean(process.env.CLOUDINARY_API_KEY) &&
    Boolean(process.env.CLOUDINARY_API_SECRET);

async function uploadFileToCloudinary(filePath, originalName) {
    if (!cloudinaryConfigured) {
        return null;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'stayguwahati/properties';

    // Cloudinary signature is SHA-1 of the sorted upload parameters
    // followed by the API secret.
    const signatureBase = `folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto
        .createHash('sha1')
        .update(signatureBase + process.env.CLOUDINARY_API_SECRET)
        .digest('hex');

    const buffer = await fs.promises.readFile(filePath);
    const form = new FormData();

    form.append('file', new Blob([buffer]), originalName || path.basename(filePath));
    form.append('api_key', process.env.CLOUDINARY_API_KEY);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('signature', signature);

    const endpoint =
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(
            process.env.CLOUDINARY_CLOUD_NAME
        )}/image/upload`;

    const response = await fetch(endpoint, {
        method: 'POST',
        body: form
    });

    const result = await response.json();

    if (!response.ok || !result.secure_url) {
        throw new Error(
            result?.error?.message ||
            `Cloudinary upload failed with status ${response.status}`
        );
    }

    return {
        url: result.secure_url,
        publicId: result.public_id
    };
}

if (cloudinaryConfigured) {
    console.log('☁️ Cloudinary image storage is ENABLED.');
} else {
    console.warn(
        '⚠️ Cloudinary image storage is NOT configured. ' +
        'New uploads will use the temporary Render /uploads filesystem.'
    );
}


// Database Connection[cite: 7]
if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI environment variable is missing!'); //[cite: 7]
} else {
    mongoose.connect(process.env.MONGODB_URI) //[cite: 7]
        .then(() => {
            console.log('Connected securely to MongoDB Atlas Instance.'); //[cite: 7]
            initScheduledJobs(); //[cite: 7]
        })
        .catch(err => console.error('❌ DATABASE CONNECTION CRASHED!', err.message)); //[cite: 7]
}

// --- BACKGROUND CRON JOBS ---[cite: 7]
function initScheduledJobs() {
    cron.schedule('0 10 * * *', async () => {
        console.log('[CRON] Checking for completed stays to send review follow-up emails...'); //[cite: 7]
        if (!resend) {
            console.warn('[CRON] Resend API key not configured. Skipping email dispatch.'); //[cite: 7]
            return; //[cite: 7]
        }

        try {
            const today = new Date(); //[cite: 7]
            today.setHours(0, 0, 0, 0); //[cite: 7]

            const completedBookings = await Booking.find({
                checkOutDate: { $lt: today },
                reviewEmailSent: { $ne: true },
                status: { $nin: ['cancelled', 'rejected'] }
            }); //[cite: 7]

            for (const booking of completedBookings) {
                if (!booking.reviewToken) {
                    booking.reviewToken = crypto.randomBytes(32).toString('hex'); //[cite: 7]
                }

                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in'; //[cite: 7]
                const reviewUrl = `${clientUrl}/review?token=${booking.reviewToken}`; //[cite: 7]

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
                }); //[cite: 7]

                booking.reviewEmailSent = true; //[cite: 7]
                await booking.save(); //[cite: 7]
                console.log(`[CRON] Review follow-up email sent to ${booking.email}`); //[cite: 7]
            }
        } catch (error) {
            console.error('[CRON] Error sending review follow-up emails:', error); //[cite: 7]
        }
    }); //[cite: 7]
}

// --- AUTHENTICATION MIDDLEWARE ---[cite: 7]
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization']; //[cite: 7]
    const token = authHeader && authHeader.split(' ')[1]; //[cite: 7]

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. Token missing.' }); //[cite: 7]
    }

    const jwtSecret = process.env.JWT_SECRET || 'stayguwahati_jwt_super_secret_key_2026'; //[cite: 7]

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' }); //[cite: 7]
        }
        req.user = user; //[cite: 7]
        next(); //[cite: 7]
    });
}; //[cite: 7]

const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        return next(); //[cite: 7]
    }
    return res.status(403).json({ success: false, message: 'Access denied. Admin rights required.' }); //[cite: 7]
}; //[cite: 7]

// Basic health/status endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        service: 'StayGuwahati backend',
        storage: cloudinaryConfigured ? 'cloudinary' : 'local',
        uploadsDirectory: uploadDir
    });
});

// --- API ROUTES ---[cite: 7]

// 1. Support Ticket Route[cite: 7]
app.post('/api/tickets', async (req, res) => {
    try {
        const { subject, description, category } = req.body; //[cite: 7]
        if (!subject || !description) {
            return res.status(400).json({ success: false, message: 'Subject and description are required.' }); //[cite: 7]
        }

        const newTicket = new Ticket({ subject, description, category }); //[cite: 7]
        await newTicket.save(); //[cite: 7]

        if (resend) {
            await resend.emails.send({
                from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                to: process.env.EMAIL_USER || 'support@stayguwahati.in',
                subject: `New Support Ticket: ${subject}`,
                text: `You have a new support request:\n\nCategory: ${category}\nDescription: ${description}`
            }); //[cite: 7]
        }

        res.status(200).json({ success: true, message: 'Ticket saved and processed successfully!' }); //[cite: 7]
    } catch (err) {
        console.error("Ticket route error:", err); //[cite: 7]
        res.status(500).json({ success: false, message: 'Failed to process ticket.' }); //[cite: 7]
    }
}); //[cite: 7]

// 2. Authentication: Login[cite: 7]
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body; //[cite: 7]
    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." }); //[cite: 7]
        }

        const user = await User.findOne({ email: email.toLowerCase() }); //[cite: 7]
        if (!user) return res.status(400).json({ success: false, message: "Invalid credentials." }); //[cite: 7]

        const isMatch = await bcrypt.compare(password, user.passwordHash); //[cite: 7]
        if (!isMatch) return res.status(400).json({ success: false, message: "Invalid credentials." }); //[cite: 7]

        const jwtSecret = process.env.JWT_SECRET || 'stayguwahati_jwt_super_secret_key_2026'; //[cite: 7]

        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            jwtSecret,
            { expiresIn: '7d' }
        ); //[cite: 7]

        res.status(200).json({
            success: true,
            token: token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        }); //[cite: 7]
    } catch (error) {
        console.error("Login error:", error); //[cite: 7]
        res.status(500).json({ success: false, message: error.message || "Auth error." }); //[cite: 7]
    }
}); //[cite: 7]

// 3. Authentication: Register[cite: 7]
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body; //[cite: 7]
    try {
        if (!email || !password || !name) {
            return res.status(400).json({ success: false, message: "Name, email, and password are required." }); //[cite: 7]
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() }); //[cite: 7]
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists." }); //[cite: 7]

        const salt = await bcrypt.genSalt(10); //[cite: 7]
        const passwordHash = await bcrypt.hash(password, salt); //[cite: 7]

        await User.create({ name, email: email.toLowerCase(), passwordHash }); //[cite: 7]
        res.status(201).json({ success: true, message: "Registration successful!" }); //[cite: 7]
    } catch (error) {
        console.error("Register error:", error); //[cite: 7]
        res.status(500).json({ success: false, message: "Server error." }); //[cite: 7]
    }
}); //[cite: 7]

// 3.5 Authentication: Forgot Password[cite: 7]
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body; //[cite: 7]
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required." }); //[cite: 7]
        }

        const user = await User.findOne({ email: email.toLowerCase() }); //[cite: 7]
        
        if (!user) {
            return res.status(200).json({ success: true, message: "If your email is registered, a reset link has been sent." }); //[cite: 7]
        }

        const resetToken = crypto.randomBytes(32).toString('hex'); //[cite: 7]
        user.resetToken = resetToken; //[cite: 7]
        user.resetTokenExpiry = Date.now() + 3600000; //[cite: 7]
        await user.save(); //[cite: 7]

        const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in'; //[cite: 7]
        const resetLink = `${clientUrl}/reset-password?token=${resetToken}`; //[cite: 7]

        if (resend) {
            await resend.emails.send({
                from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
                to: user.email,
                subject: 'Password Reset Request - StayGuwahati',
                html: `<h3>Password Reset</h3><p>Click the link below to reset your password (valid for 1 hour):</p><a href="${resetLink}">${resetLink}</a>`
            }); //[cite: 7]
        }

        res.status(200).json({ success: true, message: "Reset link sent to your email!" }); //[cite: 7]
    } catch (error) {
        console.error("[RESET] ❌ Error during password reset:", error); //[cite: 7]
        res.status(500).json({ success: false, message: "Server error during password reset." }); //[cite: 7]
    }
}); //[cite: 7]

// 3.6 Authentication: Reset Password Complete[cite: 7]
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body; //[cite: 7]

        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: "Reset token and new password are required." }); //[cite: 7]
        }

        const user = await User.findOne({
            resetToken: token,
            resetTokenExpiry: { $gt: Date.now() }
        }); //[cite: 7]

        if (!user) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset token." }); //[cite: 7]
        }

        const salt = await bcrypt.genSalt(10); //[cite: 7]
        user.passwordHash = await bcrypt.hash(newPassword, salt); //[cite: 7]
        user.resetToken = undefined; //[cite: 7]
        user.resetTokenExpiry = undefined; //[cite: 7]
        await user.save(); //[cite: 7]

        res.status(200).json({ success: true, message: "Password reset successful! You can now log in." }); //[cite: 7]
    } catch (error) {
        console.error("Reset password error:", error); //[cite: 7]
        res.status(500).json({ success: false, message: "Server error during password reset." }); //[cite: 7]
    }
}); //[cite: 7]

// 4. Booking Routes[cite: 7]
app.get('/api/bookings', async (req, res) => {
    try {
        const { email } = req.query; //[cite: 7]
        let query = {}; //[cite: 7]

        if (email) {
            query = {
                $or: [
                    { email: email.toLowerCase() },
                    { hostEmail: email.toLowerCase() }
                ]
            }; //[cite: 7]
        }

        const bookings = await Booking.find(query).populate('homestayId'); //[cite: 7]
        res.json({ success: true, data: bookings }); //[cite: 7]
    } catch (err) {
        console.error("Fetch bookings error:", err); //[cite: 7]
        res.status(500).json({ success: false, message: "Error loading bookings" }); //[cite: 7]
    }
}); //[cite: 7]

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
        } = req.body; //[cite: 7]

        // --- 1. Robust Guest Info Parsing ---[cite: 7]
        if (guestInfo) {
            if (!email && guestInfo.email) email = guestInfo.email; //[cite: 7]
            if (!phone && guestInfo.phone) phone = guestInfo.phone; //[cite: 7]
            if (!firstName && !lastName && guestInfo.fullName) {
                const parts = guestInfo.fullName.trim().split(' '); //[cite: 7]
                firstName = parts[0] || 'Valued'; //[cite: 7]
                lastName = parts.slice(1).join(' ') || 'Guest'; //[cite: 7]
            }
        }

        if ((!firstName || !lastName) && req.body.fullName) {
            const parts = req.body.fullName.trim().split(' '); //[cite: 7]
            firstName = firstName || parts[0] || 'Valued'; //[cite: 7]
            lastName = lastName || parts.slice(1).join(' ') || 'Guest'; //[cite: 7]
        }

        firstName = firstName || 'Valued'; //[cite: 7]
        lastName = lastName || 'Guest'; //[cite: 7]
        email = email || 'guest@stayguwahati.in'; //[cite: 7]
        phone = phone || '9876543210'; //[cite: 7]

        // --- 2. Flexible Property & ID Resolution ---[cite: 7]
        let targetHomestayId = homestayId || propertyId || req.body.id; //[cite: 7]
        let property = null; //[cite: 7]

        if (targetHomestayId && mongoose.Types.ObjectId.isValid(targetHomestayId)) {
            property = await Homestay.findById(targetHomestayId); //[cite: 7]
        }

        if (!property) {
            property = await Homestay.findOne({}); //[cite: 7]
        }

        if (!property) {
            property = await Homestay.create({
                title: propertyName || 'Green Villa',
                locality: 'Guwahati',
                pricePerNight: 1500,
                status: 'approved',
                ownerEmail: email
            }); //[cite: 7]
        }

        const validHomestayId = property._id; //[cite: 7]
        const targetEmail = property.ownerEmail || (property.host && property.host.email) || email; //[cite: 7]
        const propertyAddress = property.address || property.locality || 'Guwahati, Assam'; //[cite: 7]
        let googleMapsUrl = property.mapUrl || property.googleMapsLink || ''; //[cite: 7]

        // --- 3. Date & Pricing Normalization ---[cite: 7]
        let parsedCheckIn = checkIn ? new Date(checkIn) : new Date(); //[cite: 7]
        let parsedCheckOut = checkOut ? new Date(checkOut) : new Date(Date.now() + 86400000); //[cite: 7]

        if ((!checkIn || isNaN(parsedCheckIn.getTime())) && dates && dates.includes('to')) {
            const parts = dates.split('to').map(s => s.trim()); //[cite: 7]
            const d1 = new Date(parts[0]); //[cite: 7]
            const d2 = new Date(parts[1]); //[cite: 7]
            if (!isNaN(d1.getTime())) parsedCheckIn = d1; //[cite: 7]
            if (!isNaN(d2.getTime())) parsedCheckOut = d2; //[cite: 7]
        }

        if (isNaN(parsedCheckIn.getTime())) parsedCheckIn = new Date(); //[cite: 7]
        if (isNaN(parsedCheckOut.getTime()) || parsedCheckOut <= parsedCheckIn) {
            parsedCheckOut = new Date(parsedCheckIn.getTime() + 86400000); //[cite: 7]
        }

        const formattedDates = dates || `${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]}`; //[cite: 7]
        const formattedPropertyName = propertyName || property.title || property.propertyName || 'Green Villa'; //[cite: 7]
        const finalTotalPrice = totalPrice !== undefined ? totalPrice : (totalAmount !== undefined ? totalAmount : (property.pricePerNight || 1500)); //[cite: 7]

        if (!googleMapsUrl) {
            const searchQuery = encodeURIComponent(`${formattedPropertyName} ${propertyAddress}`); //[cite: 7]
            googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${searchQuery}`; //[cite: 7]
        }

        const reviewToken = crypto.randomBytes(32).toString('hex'); //[cite: 7]

        // --- 4. Save Booking ---[cite: 7]
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
        }); //[cite: 7]
        
        await newBooking.save(); //[cite: 7]

        // --- 5. Async Email Dispatch (Non-blocking) ---[cite: 7]
        if (resend) {
            const emailPromises = []; //[cite: 7]

            if (email) {
                const backendHost = process.env.BACKEND_URL || 'https://stayguwahati-backend.onrender.com'; //[cite: 7]
                const cleanHost = backendHost.replace(/\/$/, '').replace(/^http:\/\//i, 'https://'); //[cite: 7]

                let propertyImageUrl = `${cleanHost}/api/homestays/${validHomestayId}/image`; //[cite: 7]

                let rawImage = null; //[cite: 7]
                if (Array.isArray(property.images) && property.images.length > 0) {
                    rawImage = property.images[0]; //[cite: 7]
                } else if (Array.isArray(property.photos) && property.photos.length > 0) {
                    rawImage = property.photos[0]; //[cite: 7]
                } else {
                    rawImage = property.imageUrl || property.image || property.coverImage; //[cite: 7]
                }

                if (typeof rawImage === 'object' && rawImage !== null) {
                    rawImage = rawImage.url || rawImage.path || rawImage.secure_url || ''; //[cite: 7]
                }

                if (typeof rawImage === 'string' && rawImage.trim() !== '') {
                    const trimmedImg = rawImage.trim(); //[cite: 7]

                    if (trimmedImg.startsWith('data:image/')) {
                        propertyImageUrl = `${cleanHost}/api/homestays/${validHomestayId}/image`; //[cite: 7]
                    } else if (trimmedImg.startsWith('http://') || trimmedImg.startsWith('https://')) {
                        propertyImageUrl = trimmedImg.replace(/^http:\/\//i, 'https://'); //[cite: 7]
                    } else {
                        const cleanPath = trimmedImg.startsWith('/') ? trimmedImg : `/${trimmedImg}`; //[cite: 7]
                        propertyImageUrl = `${cleanHost}${cleanPath}`; //[cite: 7]
                    }
                }

                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in'; //[cite: 7]
                const reviewUrl = `${clientUrl}/review?token=${reviewToken}`; //[cite: 7]

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
                ); //[cite: 7]
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
                ); //[cite: 7]
            }

            await Promise.all(emailPromises); //[cite: 7]
        }

        return res.status(200).json({
            success: true,
            message: "Booking saved and confirmed!",
            data: newBooking
        }); //[cite: 7]

    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message }); //[cite: 7]
        }

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "This homestay was just booked for these dates. Please pick another date."
            }); //[cite: 7]
        }

        res.status(500).json({ success: false, message: error.message || "Server error during booking." }); //[cite: 7]
    }
}); //[cite: 7]

// 4.1 Update / Cancel Booking Status[cite: 7]
app.patch('/api/bookings/:id/status', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Booking ID" }); //[cite: 7]
        }

        const { status } = req.body; //[cite: 7]
        if (!status) {
            return res.status(400).json({ success: false, message: "Status field is required." }); //[cite: 7]
        }

        const updatedBooking = await Booking.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        ); //[cite: 7]

        if (!updatedBooking) {
            return res.status(404).json({ success: false, message: "Booking not found." }); //[cite: 7]
        }

        res.status(200).json({ success: true, message: "Booking status updated", data: updatedBooking }); //[cite: 7]
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." }); //[cite: 7]
    }
}); //[cite: 7]

// 4.2 Get Reviews Route[cite: 7]
app.get('/api/reviews', async (req, res) => {
    try {
        const { propertyId } = req.query; //[cite: 7]
        let filter = {}; //[cite: 7]

        if (propertyId) {
            const cleanPropertyId = propertyId.toString().trim(); //[cite: 7]
            
            if (mongoose.Types.ObjectId.isValid(cleanPropertyId)) {
                filter.propertyId = {
                    $in: [cleanPropertyId, new mongoose.Types.ObjectId(cleanPropertyId)]
                }; //[cite: 7]
            } else {
                filter.propertyId = cleanPropertyId; //[cite: 7]
            }
        }

        const reviews = await Review.find(filter).sort({ createdAt: -1 }); //[cite: 7]

        res.status(200).json({
            success: true,
            count: reviews.length,
            data: reviews
        }); //[cite: 7]
    } catch (error) {
        console.error("Fetch reviews error:", error); //[cite: 7]
        res.status(500).json({ success: false, message: "Error fetching reviews." }); //[cite: 7]
    }
}); //[cite: 7]

// 4.3 Post-Stay Review Submission Route[cite: 7]
app.post('/api/reviews', async (req, res) => {
    try {
        const { token, rating, comment, guestName } = req.body; //[cite: 7]

        if (!token) {
            return res.status(400).json({ success: false, message: "Review token is missing." }); //[cite: 7]
        }

        if (!rating) {
            return res.status(400).json({ success: false, message: "A rating is required to submit a review." }); //[cite: 7]
        }

        const booking = await Booking.findOne({ reviewToken: token }); //[cite: 7]
        if (!booking) {
            return res.status(400).json({ success: false, message: "Invalid or expired review token." }); //[cite: 7]
        }

        if (booking.reviewSubmitted) {
            return res.status(400).json({ success: false, message: "A review has already been submitted for this booking." }); //[cite: 7]
        }

        const newReview = new Review({
            propertyId: booking.propertyId || booking.homestayId,
            bookingId: booking._id,
            guestName: guestName || `${booking.firstName} ${booking.lastName}`.trim() || 'Verified Guest',
            rating: Number(rating),
            comment: comment || ''
        }); //[cite: 7]

        await newReview.save(); //[cite: 7]

        booking.reviewSubmitted = true; //[cite: 7]
        booking.reviewToken = undefined; //[cite: 7]
        await booking.save(); //[cite: 7]

        res.status(200).json({ 
            success: true, 
            message: "Thank you! Your verified review has been submitted successfully.",
            data: newReview
        }); //[cite: 7]
    } catch (error) {
        console.error("Review submission error:", error); //[cite: 7]
        res.status(500).json({ success: false, message: "Server error during review submission." }); //[cite: 7]
    }
}); //[cite: 7]

// 4.5 Send Message Route[cite: 7]
app.post(['/api/messages', '/api/messages/send'], async (req, res) => {
    try {
        const { recipientPhone, message, senderName, propertyTitle, guestName, recipient, sender } = req.body; //[cite: 7]

        if (!message) {
            return res.status(400).json({ success: false, error: "Missing required message field." }); //[cite: 7]
        }

        const finalGuestName = guestName || recipient || 'Valued Guest'; //[cite: 7]
        const finalPropertyTitle = propertyTitle || 'StayGuwahati Property'; //[cite: 7]
        const finalSenderName = senderName || sender || 'User'; //[cite: 7]

        const newMessage = new Message({
            propertyTitle: finalPropertyTitle,
            guestName: finalGuestName,
            senderName: finalSenderName,
            message,
            recipientPhone: recipientPhone || ''
        }); //[cite: 7]
        await newMessage.save(); //[cite: 7]

        let twilioSid = null; //[cite: 7]
        if (twilioClient && recipientPhone && (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER)) {
            try {
                const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in'; //[cite: 7]
                const encodedGuest = encodeURIComponent(finalGuestName); //[cite: 7]
                const encodedProp = encodeURIComponent(finalPropertyTitle); //[cite: 7]
                
                const chatLink = `${clientUrl}/chat?guest=${encodedGuest}&property=${encodedProp}`; //[cite: 7]

                let formattedPhone = recipientPhone.trim().replace(/\s+/g, ''); //[cite: 7]
                if (!formattedPhone.startsWith('+')) {
                    formattedPhone = `+91${formattedPhone.replace(/^0+/, '')}`; //[cite: 7]
                }

                const rawTwilioNumber = (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || '').trim(); //[cite: 7]
                let fromWhatsAppNumber = rawTwilioNumber.startsWith('whatsapp:')
                    ? rawTwilioNumber
                    : `whatsapp:${rawTwilioNumber}`; //[cite: 7]

                const whatsappBody = `*StayGuwahati Update*\n\nMessage from *${finalSenderName}* regarding *${finalPropertyTitle}*:\n"${message}"\n\nReply directly here:\n${chatLink}`; //[cite: 7]

                const twilioResponse = await twilioClient.messages.create({
                    body: whatsappBody,
                    from: fromWhatsAppNumber,
                    to: `whatsapp:${formattedPhone}`
                }); //[cite: 7]
                twilioSid = twilioResponse.sid; //[cite: 7]
            } catch (twilioErr) {
                console.error("Twilio Dispatch Warning:", twilioErr.message); //[cite: 7]
            }
        }

        res.status(200).json({
            success: true,
            message: "Message saved and dispatched successfully via WhatsApp.",
            data: newMessage,
            sid: twilioSid
        }); //[cite: 7]

    } catch (error) {
        res.status(500).json({ success: false, error: error.message }); //[cite: 7]
    }
}); //[cite: 7]

// 4.6 Get Messages Route[cite: 7]
app.get('/api/messages', async (req, res) => {
    try {
        const { propertyTitle, guestName, recipientPhone } = req.query; //[cite: 7]
        let filter = {}; //[cite: 7]

        if (propertyTitle) filter.propertyTitle = propertyTitle; //[cite: 7]
        if (guestName) filter.guestName = guestName; //[cite: 7]
        if (recipientPhone) filter.recipientPhone = recipientPhone; //[cite: 7]

        const messages = await Message.find(filter).sort({ createdAt: 1 }); //[cite: 7]

        res.status(200).json({
            success: true,
            data: messages
        }); //[cite: 7]
    } catch (error) {
        res.status(500).json({ success: false, error: error.message }); //[cite: 7]
    }
}); //[cite: 7]

// 4.7 Twilio Inbound Webhook[cite: 7]
app.post('/api/messages/webhook', async (req, res) => {
    try {
        const { From, Body, ProfileName } = req.body; //[cite: 7]
        const senderPhone = From ? From.replace('whatsapp:', '') : ''; //[cite: 7]

        if (Body) {
            const incomingMsg = new Message({
                propertyTitle: 'StayGuwahati Property',
                guestName: ProfileName || 'WhatsApp User',
                senderName: ProfileName || senderPhone,
                message: Body,
                recipientPhone: senderPhone
            }); //[cite: 7]
            await incomingMsg.save(); //[cite: 7]
        }

        res.type('text/xml'); //[cite: 7]
        res.status(200).send('<Response></Response>'); //[cite: 7]
    } catch (error) {
        res.status(500).send("Webhook processing error"); //[cite: 7]
    }
}); //[cite: 7]

// 5. File Upload (Supports up to 10 photos/images under flexible field keys)
app.post('/api/upload-images', (req, res) => {
    const multiUpload = upload.fields([
        { name: 'photos', maxCount: 10 },
        { name: 'images', maxCount: 10 }
    ]);

    multiUpload(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({
                success: false,
                message: `Upload error: ${err.message}`
            });
        }

        if (err) {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }

        try {
            const uploadedFiles = [];

            if (req.files) {
                if (req.files.photos) uploadedFiles.push(...req.files.photos);
                if (req.files.images) uploadedFiles.push(...req.files.images);
            }

            if (uploadedFiles.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No image files uploaded.'
                });
            }

            const backendHost = (
                process.env.BACKEND_URL ||
                'https://stayguwahati-backend.onrender.com'
            )
                .replace(/\/$/, '')
                .replace(/^http:\/\//i, 'https://');

            const results = [];

            for (const file of uploadedFiles) {
                // Preferred production path: persistent Cloudinary storage.
                if (cloudinaryConfigured) {
                    try {
                        const cloudResult = await uploadFileToCloudinary(
                            file.path,
                            file.originalname
                        );

                        if (cloudResult?.url) {
                            results.push({
                                url: cloudResult.url,
                                publicId: cloudResult.publicId
                            });

                            // Remove the temporary Render copy after Cloudinary
                            // has confirmed the upload.
                            try {
                                await fs.promises.unlink(file.path);
                            } catch (unlinkError) {
                                console.warn(
                                    'Could not remove temporary upload:',
                                    unlinkError.message
                                );
                            }

                            continue;
                        }
                    } catch (cloudError) {
                        console.error(
                            '❌ Cloudinary upload failed:',
                            cloudError.message
                        );

                        // Do not silently lose the file. Keep the local copy
                        // and return its URL as a fallback.
                    }
                }

                // Backward-compatible fallback when Cloudinary is unavailable.
                results.push({
                    url: `${backendHost}/uploads/${encodeURIComponent(file.filename)}`,
                    publicId: null
                });
            }

            const filePaths = results.map(item => item.url);

            return res.status(200).json({
                success: true,
                images: filePaths,
                urls: filePaths,
                files: results,
                storage: cloudinaryConfigured ? 'cloudinary' : 'local'
            });
        } catch (uploadError) {
            console.error('❌ Image upload route error:', uploadError);

            return res.status(500).json({
                success: false,
                message: 'Image upload failed.',
                error: uploadError.message
            });
        }
    });
});

// 6. Homestay Operations[cite: 7]
const getHomestaysHandler = async (req, res) => {
    try {
        const { locality, maxPrice, feature, status } = req.query; //[cite: 7]
        let queryFilter = {}; //[cite: 7]

        if (status) {
            queryFilter.status = status.toLowerCase(); //[cite: 7]
        } else {
            queryFilter.status = 'approved'; //[cite: 7]
        }

        if (locality) queryFilter.locality = locality; //[cite: 7]
        if (maxPrice) queryFilter.pricePerNight = { $lte: Number(maxPrice) }; //[cite: 7]
        if (feature) queryFilter.features = { $in: [feature] }; //[cite: 7]

        const listings = await Homestay.find(queryFilter).sort({ createdAt: -1 }); //[cite: 7]
        res.status(200).json({ success: true, count: listings.length, data: listings }); //[cite: 7]
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error' }); //[cite: 7]
    }
}; //[cite: 7]

const getSingleHomestayHandler = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID format'
            });
        }

        // Use lean() so the exact MongoDB avatar URL is returned
        // without Mongoose getters modifying it.
        const homestay = await Homestay
            .findById(req.params.id)
            .lean();

        if (!homestay) {
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }

        // Only create fallback avatar if the real avatar is missing.
        if (
            homestay.host &&
            (
                !homestay.host.avatar ||
                typeof homestay.host.avatar !== 'string' ||
                homestay.host.avatar.trim() === ''
            )
        ) {
            homestay.host.avatar =
                `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    homestay.host.name || 'Host'
                )}&background=0d9488&color=fff&size=128`;
        }

        console.log(
            '[HOMESTAY API] Host:',
            homestay.host?.name
        );

        console.log(
            '[HOMESTAY API] Avatar:',
            homestay.host?.avatar
        );

        return res.status(200).json({
            success: true,
            data: homestay
        });

    } catch (error) {
        console.error(
            'Error fetching single homestay:',
            error
        );

        return res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};
app.get('/api/homestays', getHomestaysHandler); //[cite: 7]
app.get('/api/properties', getHomestaysHandler); //[cite: 7]

app.get('/api/homestays/:id', getSingleHomestayHandler); //[cite: 7]
app.get('/api/properties/:id', getSingleHomestayHandler); //[cite: 7]

app.get('/api/homestays/:id/image', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).send("Invalid ID format"); //[cite: 7]
        }

        const homestay = await Homestay.findById(req.params.id); //[cite: 7]
        if (!homestay) return res.status(404).send("Property not found"); //[cite: 7]

        let rawImage = (homestay.images && homestay.images[0]) ||
                         (homestay.photos && homestay.photos[0]) ||
                         homestay.imageUrl || homestay.image; //[cite: 7]

        if (typeof rawImage === 'object' && rawImage !== null) {
            rawImage = rawImage.url || rawImage.path || rawImage.secure_url || ''; //[cite: 7]
        }

        if (typeof rawImage === 'string' && rawImage.startsWith('data:image/')) {
            const matches = rawImage.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/); //[cite: 7]
            if (matches) {
                const contentType = matches[1]; //[cite: 7]
                const imageBuffer = Buffer.from(matches[2], 'base64'); //[cite: 7]
                res.setHeader('Content-Type', contentType); //[cite: 7]
                res.setHeader('Cache-Control', 'public, max-age=86400'); //[cite: 7]
                return res.send(imageBuffer); //[cite: 7]
            }
        }

        if (typeof rawImage === 'string' && rawImage.trim().length > 0) {
            let trimmed = rawImage.trim().replace(/\\/g, '/'); //[cite: 7]
            
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                return res.redirect(trimmed); //[cite: 7]
            }
            const backendHost = process.env.BACKEND_URL || 'https://stayguwahati-backend.onrender.com'; //[cite: 7]
            const cleanHost = backendHost.replace(/\/$/, '').replace(/^http:\/\//i, 'https://'); //[cite: 7]
            const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`; //[cite: 7]
            return res.redirect(`${cleanHost}${cleanPath}`); //[cite: 7]
        }

        res.redirect('https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=600&q=80'); //[cite: 7]
    } catch (err) {
        res.status(500).send("Error loading image"); //[cite: 7]
    }
}); //[cite: 7]

app.post('/api/homestays', async (req, res) => {
    try {
        const formattedData = {
            ...req.body,
            host: {
    name:
        req.body.owner ||
        req.body.host?.name ||
        'Unknown Host',

    phone:
        req.body.phone ||
        req.body.host?.phone ||
        '',

    email:
        req.body.email ||
        req.body.host?.email ||
        '',

    avatar:
        req.body.avatar ||
        req.body.host?.avatar ||
        ''
},
            status: req.body.status ? req.body.status.toLowerCase() : 'pending'
        }; //[cite: 7]

        const newStay = await Homestay.create(formattedData); //[cite: 7]
        res.status(201).json({ success: true, message: 'Listing created!', data: newStay }); //[cite: 7]
    } catch (error) {
        res.status(400).json({ success: false, message: 'Validation failed', error: error.message }); //[cite: 7]
    }
}); //[cite: 7]

app.put('/api/homestays/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Property ID format'
            });
        }

        const existingProperty = await Homestay.findById(id);

        if (!existingProperty) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.'
            });
        }

        // Only update fields that are actually supplied.
        const allowedFields = [
            'title',
            'locality',
            'description',
            'pricePerNight',
            'lat',
            'lng',
            'images',
            'features',
            'isAvailable'
        ];

        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                existingProperty[field] = req.body[field];
            }
        });

        // IMPORTANT:
        // Merge host fields instead of replacing the complete host object.
        // This preserves required host.name and host.email.
        if (req.body.host && typeof req.body.host === 'object') {
            if (req.body.host.name !== undefined) {
                existingProperty.host.name = req.body.host.name;
            }

            if (req.body.host.email !== undefined) {
                existingProperty.host.email = req.body.host.email;
            }

            if (req.body.host.phone !== undefined) {
                existingProperty.host.phone = req.body.host.phone;
            }

            if (req.body.host.avatar !== undefined) {
                existingProperty.host.avatar = req.body.host.avatar;
            }

            if (req.body.host.isVerified !== undefined) {
                existingProperty.host.isVerified =
                    req.body.host.isVerified;
            }
        }

        await existingProperty.save();

        return res.status(200).json({
            success: true,
            message: 'Property updated successfully!',
            data: existingProperty
        });

    } catch (error) {
        console.error('❌ Property update error:', error);

        return res.status(500).json({
            success: false,
            message: 'Server error during update.',
            error: error.message,
            details: error.errors
                ? Object.keys(error.errors).map((key) => ({
                    field: key,
                    message: error.errors[key].message
                }))
                : undefined
        });
    }
}); //[cite: 7]

app.delete('/api/homestays/:id', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Property ID format" }); //[cite: 7]
        }

        const deletedProperty = await Homestay.findByIdAndDelete(req.params.id); //[cite: 7]
        if (!deletedProperty) {
            return res.status(404).json({ success: false, message: "Property not found." }); //[cite: 7]
        }

        res.status(200).json({ success: true, message: "Property deleted successfully." }); //[cite: 7]
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during deletion." }); //[cite: 7]
    }
}); //[cite: 7]

app.patch('/api/admin/homestays/:id/status', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Property ID format" }); //[cite: 7]
        }

        if (!req.body.status) {
            return res.status(400).json({ success: false, message: "Status is required in request body" }); //[cite: 7]
        }

        const updatedProperty = await Homestay.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status.toLowerCase() },
            { new: true, runValidators: true }
        ); //[cite: 7]
        
        if (!updatedProperty) return res.status(404).json({ success: false, message: "Property not found." }); //[cite: 7]
        res.json({ success: true, message: "Status updated!", data: updatedProperty }); //[cite: 7]
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error." }); //[cite: 7]
    }
}); //[cite: 7]

// Centralized Global Error Handler[cite: 7]
app.use((err, req, res, next) => {
    console.error("Unhandled Global Error:", err); //[cite: 7]
    res.status(500).json({ success: false, message: err.message || "Internal Server Error" }); //[cite: 7]
}); //[cite: 7]

const PORT = process.env.PORT || 5000; //[cite: 7]
app.listen(PORT, () => {
    console.log(`StayGuwahati Core Engine running on port ${PORT}`); //[cite: 7]
});