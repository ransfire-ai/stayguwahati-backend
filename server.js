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


// ============================================================
// ROBUST MONGODB CONNECTION / READINESS
// ============================================================
// Do not let Mongoose buffer database queries during a Render cold start.
// The previous implementation could leave /api/homestays waiting for a
// long time while MongoDB was still connecting.
mongoose.set('bufferCommands', false);

let databaseConnectedAt = null;
let databaseLastError = null;
let databaseConnectPromise = null;
let scheduledJobsStarted = false;

function getDatabaseState() {
    return {
        readyState: mongoose.connection.readyState,
        connected: mongoose.connection.readyState === 1,
        connecting: mongoose.connection.readyState === 2,
        disconnected: mongoose.connection.readyState === 0,
        database: mongoose.connection.name || null,
        connectedAt: databaseConnectedAt,
        lastError: databaseLastError
    };
}

async function connectDatabase() {
    if (!process.env.MONGODB_URI) {
        databaseLastError = 'MONGODB_URI environment variable is missing.';
        throw new Error(databaseLastError);
    }

    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (databaseConnectPromise) {
        return databaseConnectPromise;
    }

    databaseConnectPromise = mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
        socketTimeoutMS: 15000,
        maxPoolSize: 10,
        minPoolSize: 1,
        maxIdleTimeMS: 30000,
        heartbeatFrequencyMS: 10000,
        family: 4
    })
        .then((connection) => {
            databaseConnectedAt = new Date().toISOString();
            databaseLastError = null;
            console.log(`✅ MongoDB connected: ${connection.connection.name || 'database'}`);

            if (!scheduledJobsStarted) {
                scheduledJobsStarted = true;
                initScheduledJobs();
            }

            return connection;
        })
        .catch((error) => {
            databaseLastError = error.message || 'MongoDB connection failed.';
            console.error('❌ MongoDB connection failed:', databaseLastError);
            throw error;
        })
        .finally(() => {
            databaseConnectPromise = null;
        });

    return databaseConnectPromise;
}

mongoose.connection.on('connected', () => {
    databaseConnectedAt = databaseConnectedAt || new Date().toISOString();
    databaseLastError = null;
    console.log('🟢 MongoDB connection is ready.');
});

mongoose.connection.on('disconnected', () => {
    console.warn('🟠 MongoDB disconnected. Waiting for automatic reconnect...');
});

mongoose.connection.on('error', (error) => {
    databaseLastError = error?.message || 'MongoDB connection error.';
    console.error('❌ MongoDB connection error:', databaseLastError);
});

async function requireDatabase(req, res, next) {
    if (mongoose.connection.readyState === 1) return next();

    try {
        await Promise.race([
            connectDatabase(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Database readiness timeout.')), 5000)
            )
        ]);

        if (mongoose.connection.readyState !== 1) {
            throw new Error('MongoDB is not ready.');
        }

        return next();
    } catch (error) {
        databaseLastError = error.message || 'Database unavailable.';
        return res.status(503).json({
            success: false,
            code: 'DATABASE_UNAVAILABLE',
            message: 'StayGuwahati database is temporarily unavailable. Please retry in a few seconds.',
            retryAfterSeconds: 5,
            database: getDatabaseState()
        });
    }
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

// Basic health/status endpoint. Keep it independent of MongoDB so Render
// can always use it as a liveness check.
app.get('/api/health', (req, res) => {
    const db = getDatabaseState();
    res.status(200).json({
        success: true,
        service: 'StayGuwahati backend',
        storage: cloudinaryConfigured ? 'cloudinary' : 'local',
        uploadsDirectory: uploadDir,
        database: {
            connected: db.connected,
            connecting: db.connecting,
            readyState: db.readyState,
            database: db.database,
            connectedAt: db.connectedAt,
            lastError: db.lastError
        },
        timestamp: new Date().toISOString()
    });
});

// All API routes below this point use MongoDB. Fail fast with a clean 503
// instead of allowing Mongoose to buffer queries during a cold start.
app.use('/api', requireDatabase);

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

app.get('/api/bookings/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid Booking ID.' });
        const booking = await Booking.findById(req.params.id).populate('homestayId');
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
        return res.json({ success: true, data: booking });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error loading booking.' });
    }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            fullName,
            email,
            phone,
            guestInfo,
            homestayId,
            propertyId,
            checkIn,
            checkOut,
            guests,
            specialRequests,
            userId
        } = req.body;

        const guestEmail = String(email || guestInfo?.email || '').trim().toLowerCase();
        const guestPhone = String(phone || guestInfo?.phone || '').trim();
        const suppliedName = String(fullName || guestInfo?.fullName || '').trim();
        const parts = suppliedName ? suppliedName.split(/\s+/) : [];
        const finalFirstName = String(firstName || parts[0] || '').trim();
        const finalLastName = String(lastName || parts.slice(1).join(' ') || '').trim();

        if (!finalFirstName) return res.status(400).json({ success: false, message: 'Full name is required.' });
        if (!guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
            return res.status(400).json({ success: false, message: 'A valid email address is required.' });
        }
        if (!guestPhone) return res.status(400).json({ success: false, message: 'Phone number is required.' });

        const targetId = homestayId || propertyId || req.body.id;
        if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ success: false, message: 'A valid property is required.' });
        }

        const property = await Homestay.findById(targetId);
        if (!property) return res.status(404).json({ success: false, message: 'Property not found.' });
        if (property.status && property.status !== 'approved') {
            return res.status(400).json({ success: false, message: 'This property is not currently available for booking.' });
        }
        if (property.isAvailable === false) {
            return res.status(400).json({ success: false, message: 'This property is currently unavailable.' });
        }

        const parsedCheckIn = new Date(checkIn);
        const parsedCheckOut = new Date(checkOut);
        if (isNaN(parsedCheckIn.getTime()) || isNaN(parsedCheckOut.getTime()) || parsedCheckOut <= parsedCheckIn) {
            return res.status(400).json({ success: false, message: 'Please select valid check-in and check-out dates.' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedCheckIn < today) {
            return res.status(400).json({ success: false, message: 'Check-in date cannot be in the past.' });
        }

        const nights = Math.ceil((parsedCheckOut - parsedCheckIn) / (1000 * 60 * 60 * 24));
        const guestCount = Math.max(1, Number(guests) || 1);
        const nightlyRate = Number(property.pricePerNight || 0);
        const serverTotal = nightlyRate * nights;

        // Do not allow overlapping requested/confirmed bookings.
        const conflict = await Booking.findOne({
            homestayId: property._id,
            status: { $in: ['Requested', 'Confirmed'] },
            checkInDate: { $lt: parsedCheckOut },
            checkOutDate: { $gt: parsedCheckIn }
        });
        if (conflict) {
            return res.status(409).json({ success: false, message: 'These dates are already requested or booked. Please choose different dates.' });
        }

        const hostEmail = String(property.ownerEmail || property.host?.email || '').trim().toLowerCase();
        const reviewToken = crypto.randomBytes(32).toString('hex');
        const booking = new Booking({
            firstName: finalFirstName,
            lastName: finalLastName || 'Guest',
            email: guestEmail,
            phone: guestPhone,
            userId: userId || null,
            propertyId: property._id,
            homestayId: property._id,
            propertyName: property.title,
            dates: `${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]}`,
            checkInDate: parsedCheckIn,
            checkOutDate: parsedCheckOut,
            hostEmail,
            nights,
            guests: guestCount,
            totalPrice: serverTotal,
            nightlyRate,
            specialRequests: String(specialRequests || '').trim(),
            status: 'Requested',
            reviewToken,
            reviewSubmitted: false,
            reviewEmailSent: false
        });

        await booking.save();

        // Send a request email, not a confirmation email. The booking is only confirmed after host approval.
        if (resend) {
            const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
            const bookingUrl = `${clientUrl}/dashboard`;
            const emailTasks = [];

            emailTasks.push(resend.emails.send({
                from: process.env.FROM_EMAIL || 'StayGuwahati <onboarding@resend.dev>',
                to: guestEmail,
                subject: `Booking request received: ${property.title}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a"><h2>StayGuwahati</h2><p>Hi ${finalFirstName},</p><p>Your booking request has been sent to the host. It is <strong>not confirmed yet</strong>.</p><p><strong>${property.title}</strong><br>${property.locality}, Guwahati<br>${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]} · ${guestCount} guest(s)<br>₹${serverTotal.toLocaleString('en-IN')}</p><p>The host will review your request and you will be notified when it is accepted or declined.</p><a href="${bookingUrl}">View My Bookings</a></div>`
            }).catch(e => console.error('Guest request email error:', e.message)));

            if (hostEmail) {
                emailTasks.push(resend.emails.send({
                    from: process.env.FROM_EMAIL || 'StayGuwahati <onboarding@resend.dev>',
                    to: hostEmail,
                    subject: `New booking request: ${property.title}`,
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a"><h2>New Booking Request</h2><p><strong>${finalFirstName} ${finalLastName}</strong> requested a stay at <strong>${property.title}</strong>.</p><p>Dates: ${parsedCheckIn.toISOString().split('T')[0]} to ${parsedCheckOut.toISOString().split('T')[0]}<br>Guests: ${guestCount}<br>Total: ₹${serverTotal.toLocaleString('en-IN')}<br>Guest phone: ${guestPhone}<br>Guest email: ${guestEmail}</p><p>Open your StayGuwahati host dashboard to accept or reject the request.</p></div>`
                }).catch(e => console.error('Host request email error:', e.message)));
            }
            await Promise.all(emailTasks);
        }

        return res.status(201).json({
            success: true,
            message: 'Booking request submitted. Waiting for host approval.',
            data: booking
        });
    } catch (error) {
        console.error('Create booking request error:', error);
        if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
        return res.status(500).json({ success: false, message: error.message || 'Server error while creating booking request.' });
    }
});

// Host accepts/rejects a booking request. No payment is processed here.
app.patch('/api/bookings/:id/status', authenticateToken, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid Booking ID.' });
        }

        const requestedStatus = String(req.body.status || '').trim();
        const statusMap = { accept: 'Confirmed', accepted: 'Confirmed', confirm: 'Confirmed', confirmed: 'Confirmed', reject: 'Rejected', rejected: 'Rejected' };
        const newStatus = statusMap[requestedStatus.toLowerCase()];
        if (!newStatus) return res.status(400).json({ success: false, message: 'Status must be accept/confirmed or reject/rejected.' });

        const booking = await Booking.findById(req.params.id).populate('homestayId');
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });

        const property = booking.homestayId || await Homestay.findById(booking.homestayId || booking.propertyId);
        const hostEmail = String(property?.ownerEmail || property?.host?.email || booking.hostEmail || '').toLowerCase().trim();
        const actorEmail = String(req.user?.email || '').toLowerCase().trim();
        if (!hostEmail || actorEmail !== hostEmail) {
            return res.status(403).json({ success: false, message: 'You are not authorized to manage this booking.' });
        }

        if (booking.status !== 'Requested') {
            return res.status(400).json({ success: false, message: `This booking is already ${booking.status}.` });
        }

        if (newStatus === 'Confirmed') {
            const conflict = await Booking.findOne({
                _id: { $ne: booking._id },
                homestayId: booking.homestayId,
                status: 'Confirmed',
                checkInDate: { $lt: booking.checkOutDate },
                checkOutDate: { $gt: booking.checkInDate }
            });
            if (conflict) return res.status(409).json({ success: false, message: 'Those dates have already been confirmed for another guest.' });
        }

        booking.status = newStatus;
        await booking.save();

        if (resend && booking.email) {
            const approved = newStatus === 'Confirmed';
            const clientUrl = process.env.CLIENT_URL || 'https://stayguwahati.in';
            await resend.emails.send({
                from: process.env.FROM_EMAIL || 'StayGuwahati <onboarding@resend.dev>',
                to: booking.email,
                subject: approved ? `Booking confirmed: ${booking.propertyName}` : `Booking request declined: ${booking.propertyName}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a"><h2>StayGuwahati</h2><p>Hi ${booking.firstName || 'Guest'},</p><p>Your request for <strong>${booking.propertyName}</strong> has been <strong>${approved ? 'confirmed' : 'declined'}</strong>.</p><p>${booking.dates}<br>${booking.guests || 1} guest(s)<br>Total: ₹${Number(booking.totalPrice || 0).toLocaleString('en-IN')}</p>${approved ? '<p>The host will contact you regarding check-in arrangements.</p>' : '<p>Please search StayGuwahati for another available stay.</p>'}<a href="${clientUrl}/dashboard">View My Bookings</a></div>`
            }).catch(e => console.error('Booking status email error:', e.message));
        }

        return res.json({ success: true, message: `Booking ${newStatus.toLowerCase()}.`, data: booking });
    } catch (error) {
        console.error('Booking status update error:', error);
        return res.status(500).json({ success: false, message: 'Server error while updating booking.' });
    }
});

// 4.2 Get Reviews Route[cite: 7]

// ============================================================
// VERIFIED REVIEWS
// A review is allowed only when:
//   1) the authenticated user owns the booking,
//   2) the booking belongs to the requested property,
//   3) the booking is genuinely completed,
//   4) the booking has not already been reviewed.
// The review token is an additional secure hand-off for the email flow.
// ============================================================

function normalizeBookingStatus(status) {
    return String(status || '').trim().toLowerCase();
}

function bookingUserMatches(booking, user) {
    if (!booking || !user) return false;

    const bookingUserId =
        booking.userId ||
        booking.user ||
        booking.guestUserId ||
        booking.user?._id;

    if (bookingUserId && user.userId) {
        if (String(bookingUserId) === String(user.userId)) return true;
    }

    const bookingEmail = String(
        booking.email ||
        booking.guestInfo?.email ||
        ''
    ).trim().toLowerCase();

    const userEmail = String(user.email || '').trim().toLowerCase();

    return Boolean(bookingEmail && userEmail && bookingEmail === userEmail);
}

function bookingPropertyMatches(booking, propertyId) {
    if (!booking || !propertyId) return false;

    const ids = [
        booking.homestayId,
        booking.propertyId,
        booking.homestay?._id,
        booking.homestay?.id
    ].filter(Boolean).map(String);

    return ids.includes(String(propertyId));
}

function isBookingCompleted(booking) {
    const status = normalizeBookingStatus(booking?.status);

    // Prefer an explicit completed status.
    if (['completed', 'complete', 'checkedout', 'checked-out'].includes(status)) {
        return true;
    }

    // Also allow a confirmed booking whose checkout date has passed.
    // This matches the dashboard's completed-stay lifecycle without
    // silently changing the database booking status here.
    if (['confirmed', 'accepted', 'approved'].includes(status) && booking?.checkOutDate) {
        const checkout = new Date(booking.checkOutDate);
        if (!Number.isNaN(checkout.getTime()) && checkout.getTime() < Date.now()) {
            return true;
        }
    }

    return false;
}

async function findReviewForBooking(booking) {
    if (!booking) return null;

    const queries = [{ booking: booking._id }];

    // Backward compatibility for Review schemas that use bookingId.
    queries.push({ bookingId: booking._id });

    return Review.findOne({ $or: queries });
}

// Public property review list. Submission remains protected below.
app.get('/api/reviews', async (req, res) => {
    try {
        const propertyId = String(req.query.propertyId || '').trim();

        if (!propertyId) {
            return res.status(400).json({
                success: false,
                message: 'propertyId is required.'
            });
        }

        const query = {
            $or: [
                { propertyId },
                ...(mongoose.Types.ObjectId.isValid(propertyId)
                    ? [{ property: propertyId }, { homestayId: propertyId }]
                    : [])
            ]
        };

        const reviews = await Review.find(query)
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            data: reviews
        });
    } catch (error) {
        console.error('[REVIEWS] Fetch error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to load reviews.'
        });
    }
});

// Verify the secure review token and enforce the completed-booking rule.
app.get('/api/reviews/verify', async (req, res) => {
    try {
        const token = String(req.query.token || '').trim();

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Review token is required.'
            });
        }

        const booking = await Booking.findOne({ reviewToken: token }).lean();

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'This review link is invalid or no longer available.'
            });
        }

        if (!isBookingCompleted(booking)) {
            return res.status(403).json({
                success: false,
                message: 'You can review a property only after completing your stay.'
            });
        }

        const existingReview = await findReviewForBooking(booking);

        if (existingReview) {
            return res.status(409).json({
                success: false,
                message: 'You have already reviewed this stay.',
                data: {
                    propertyName: booking.propertyName,
                    propertyId: booking.homestayId || booking.propertyId,
                    reviewSubmitted: true
                }
            });
        }

        return res.json({
            success: true,
            data: {
                propertyName: booking.propertyName,
                propertyId: booking.homestayId || booking.propertyId,
                guestName: booking.firstName
                    ? `${booking.firstName}${booking.lastName ? ` ${booking.lastName}` : ''}`
                    : '',
                checkInDate: booking.checkInDate || booking.checkIn,
                checkOutDate: booking.checkOutDate || booking.checkOut,
                reviewSubmitted: false
            }
        });
    } catch (error) {
        console.error('[REVIEWS] Verify error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to verify this review link.'
        });
    }
});

// Authenticated review submission.
// The browser cannot choose another user/property/booking because the
// backend derives the review identity from the verified booking token.
app.post('/api/reviews', authenticateToken, async (req, res) => {
    try {
        const token = String(req.body.token || '').trim();
        const rating = Number(req.body.rating);
        const comment = String(req.body.comment || '').trim();

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Secure review token is required.'
            });
        }

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be a whole number from 1 to 5.'
            });
        }

        if (comment.length > 1000) {
            return res.status(400).json({
                success: false,
                message: 'Review comment cannot exceed 1000 characters.'
            });
        }

        const booking = await Booking.findOne({ reviewToken: token });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'This review link is invalid or no longer available.'
            });
        }

        // booking.user === loggedInUser
        if (!bookingUserMatches(booking, req.user)) {
            return res.status(403).json({
                success: false,
                message: 'You can review only your own completed booking.'
            });
        }

        // booking.property === requested property
        const propertyId =
            booking.homestayId ||
            booking.propertyId ||
            booking.homestay;

        if (!bookingPropertyMatches(booking, propertyId)) {
            return res.status(403).json({
                success: false,
                message: 'This booking is not linked to a valid property.'
            });
        }

        // booking.status === COMPLETED
        if (!isBookingCompleted(booking)) {
            return res.status(403).json({
                success: false,
                message: 'You can review a property only after completing your stay.'
            });
        }

        // review already exists?
        const existingReview = await findReviewForBooking(booking);

        if (existingReview) {
            return res.status(409).json({
                success: false,
                message: 'You have already reviewed this stay.'
            });
        }

        const reviewPayload = {
            booking: booking._id,
            bookingId: booking._id,
            propertyId: propertyId,
            homestayId: propertyId,
            user: req.user.userId,
            userId: req.user.userId,
            guestName: booking.firstName
                ? `${booking.firstName}${booking.lastName ? ` ${booking.lastName}` : ''}`
                : (req.user.email || 'Guest'),
            guestEmail: String(booking.email || req.user.email || '').toLowerCase(),
            rating,
            comment,
            verifiedStay: true,
            createdAt: new Date()
        };

        const review = await Review.create(reviewPayload);

        // Make the token single-use after successful submission.
        booking.reviewSubmitted = true;
        booking.reviewSubmittedAt = new Date();
        await booking.save();

        return res.status(201).json({
            success: true,
            message: 'Verified review submitted successfully.',
            data: review
        });
    } catch (error) {
        // A unique index/constraint on booking should also protect against
        // concurrent duplicate submissions.
        if (error?.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'You have already reviewed this stay.'
            });
        }

        console.error('[REVIEWS] Submission error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to submit your review.'
        });
    }
});

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
    const startedAt = Date.now();

    try {
        const { locality, maxPrice, feature, status } = req.query;
        const queryFilter = {};

        if (status) queryFilter.status = String(status).toLowerCase();
        else queryFilter.status = 'approved';

        if (locality) queryFilter.locality = String(locality).trim();

        if (maxPrice) {
            const parsedMaxPrice = Number(maxPrice);
            if (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice < 0) {
                return res.status(400).json({
                    success: false,
                    code: 'INVALID_MAX_PRICE',
                    message: 'maxPrice must be a valid positive number.'
                });
            }
            queryFilter.pricePerNight = { $lte: parsedMaxPrice };
        }

        if (feature) queryFilter.features = { $in: [String(feature)] };

        const listings = await Homestay
            .find(queryFilter)
            .sort({ createdAt: -1 })
            .maxTimeMS(6000)
            .lean();

        const durationMs = Date.now() - startedAt;
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        console.log(`[HOMESTAYS] ${listings.length} listing(s) returned in ${durationMs}ms`, queryFilter);

        return res.status(200).json({
            success: true,
            count: listings.length,
            data: listings,
            meta: { durationMs, databaseReadyState: mongoose.connection.readyState }
        });
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        console.error(`[HOMESTAYS] Failed after ${durationMs}ms:`, error?.message || error);

        return res.status(503).json({
            success: false,
            code: 'HOMESTAYS_DATABASE_ERROR',
            message: 'Unable to load properties from the database right now. Please retry.',
            retryAfterSeconds: 5,
            durationMs
        });
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

        const property = await Homestay.findById(id);

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.'
            });
        }

        const editableFields = [
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

        editableFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                property[field] = req.body[field];
            }
        });

        // Merge host fields instead of replacing the required host object.
        if (req.body.host && typeof req.body.host === 'object') {
            if (req.body.host.name !== undefined) {
                property.host.name = req.body.host.name;
            }
            if (req.body.host.email !== undefined) {
                property.host.email = req.body.host.email;
            }
            if (req.body.host.phone !== undefined) {
                property.host.phone = req.body.host.phone;
            }
            if (req.body.host.avatar !== undefined) {
                property.host.avatar = req.body.host.avatar;
            }
            if (req.body.host.isVerified !== undefined) {
                property.host.isVerified = req.body.host.isVerified;
            }
        }

        await property.save();

        return res.status(200).json({
            success: true,
            message: 'Property updated successfully!',
            data: property
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
});

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

const server = app.listen(PORT, () => {
    console.log(`🚀 StayGuwahati Core Engine running on port ${PORT}`);
});

// Warm MongoDB immediately after the HTTP server starts. If the first
// connection fails, database-backed requests will retry through the
// requireDatabase middleware instead of hanging.
connectDatabase().catch((error) => {
    console.error(
        '⚠️ Initial MongoDB connection was not ready. The server remains online and database requests will retry automatically.',
        error?.message || error
    );
});

server.on('error', (error) => {
    console.error('❌ HTTP server error:', error);
});