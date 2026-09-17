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
const HostAgreement = require('./models/HostAgreement');

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


// ============================================================
// CLOUDINARY IMAGE OPTIMIZATION
// ============================================================
// Existing Cloudinary images are optimized at delivery time.
// No re-upload is required. Cloudinary selects WebP/AVIF when
// supported and automatically optimizes image quality.
function optimizeCloudinaryUrl(imageUrl, options = {}) {
    if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
    if (!imageUrl.includes('res.cloudinary.com')) return imageUrl;
    if (imageUrl.includes('/f_auto,') || imageUrl.includes('/q_auto')) return imageUrl;

    const width = Math.max(100, Math.min(Number(options.width) || 1600, 2000));
    const quality = options.quality || 'auto:good';
    const format = options.format || 'auto';

    return imageUrl.replace(
        '/image/upload/',
        `/image/upload/f_${format},q_${quality},c_limit,w_${width}/`
    );
}

function optimizeImageUrl(image, width = 1600) {
    if (!image) return image;

    if (typeof image === 'object' && image !== null) {
        const url = image.url || image.secure_url || image.path || '';
        if (!url) return image;
        return optimizeCloudinaryUrl(url, { width });
    }

    return optimizeCloudinaryUrl(String(image), { width });
}

function optimizePropertyImages(images, width = 1600) {
    if (!Array.isArray(images)) return images || [];
    return images.map(image => optimizeImageUrl(image, width));
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

// ============================================================
// DIRECT-TO-HOST COMMISSION SETTLEMENTS
// Guest accommodation payments do not pass through StayGuwahati.
// ============================================================
const FOUNDING_HOST_LIMIT = Math.max(0, Number(process.env.FOUNDING_HOST_LIMIT || 30));
const FOUNDING_HOST_COMMISSION_RATE = Number(process.env.STAYGUWAHATI_FOUNDING_COMMISSION_RATE || 8);
const STANDARD_HOST_COMMISSION_RATE = Number(process.env.STAYGUWAHATI_STANDARD_COMMISSION_RATE || 10);
const COMMISSION_TAX_RATE = Number(process.env.STAYGUWAHATI_COMMISSION_TAX_RATE || 18);

function hostIdentityFromProperty(property) {
    return String(property?.ownerEmail || property?.host?.email || property?.hostEmail || '').trim().toLowerCase();
}

async function resolveHostCommissionRate(property) {
    const explicit = Number(property?.commissionRate);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;

    const target = hostIdentityFromProperty(property);
    if (target) {
        const acceptedAgreement = await HostAgreement.findOne({ hostEmail: target, status: 'accepted' }).select('commissionRate').lean();
        if (acceptedAgreement && Number.isFinite(Number(acceptedAgreement.commissionRate)) && Number(acceptedAgreement.commissionRate) >= 0) {
            return Number(acceptedAgreement.commissionRate);
        }
    }
    if (!target || FOUNDING_HOST_LIMIT <= 0) return STANDARD_HOST_COMMISSION_RATE;
    const properties = await Homestay.find({
        $or: [{ ownerEmail: { $exists: true, $ne: '' } }, { 'host.email': { $exists: true, $ne: '' } }]
    }).select('ownerEmail host.email createdAt _id').sort({ createdAt: 1, _id: 1 }).lean();
    const seen = new Set();
    const hosts = [];
    for (const p of properties) {
        const identity = hostIdentityFromProperty(p);
        if (identity && !seen.has(identity)) { seen.add(identity); hosts.push(identity); }
    }
    return hosts.slice(0, FOUNDING_HOST_LIMIT).includes(target) ? FOUNDING_HOST_COMMISSION_RATE : STANDARD_HOST_COMMISSION_RATE;
}

const HOST_AGREEMENT_VERSION = process.env.STAYGUWAHATI_HOST_AGREEMENT_VERSION || 'SG-2026-01';

const HOST_AGREEMENT_TERMS = [
    {
        title: '1. Platform Role',
        body: 'StayGuwahati is a marketplace and booking coordination platform that helps guests discover local accommodation providers. The host remains responsible for the accommodation, guest stay, property operations, and compliance with applicable laws.'
    },
    {
        title: '2. Guest Payments',
        body: 'Guest accommodation payments are made directly to the Host. StayGuwahati does not collect, hold, or process the accommodation amount for the Host under this arrangement. The Host is responsible for providing the guest with accurate payment instructions and applicable receipts.'
    },
    {
        title: '3. StayGuwahati Commission',
        body: 'The Host agrees to pay StayGuwahati the applicable commission on confirmed/completed booking value generated through the platform. Applicable taxes on StayGuwahati\'s commission may be charged in addition. The commission rate recorded for a booking is a snapshot and is not changed retrospectively by later rate changes.'
    },
    {
        title: '4. Founding Host Rate',
        body: 'The first 30 Host accounts accepted into the founding-host programme may receive the Founding Host Commission Rate shown in the Host Dashboard. The applicable rate is recorded when the Host accepts this agreement and remains the Host\'s recorded rate unless the parties agree otherwise in writing. Hosts outside the founding allocation are subject to the Standard Commission Rate shown in the dashboard.'
    },
    {
        title: '5. Property Information',
        body: 'The Host must provide truthful, current, and complete information about the property, including photographs, location, amenities, pricing, availability, house rules, and cancellation terms. The Host must promptly correct information that becomes inaccurate.'
    },
    {
        title: '6. Bookings and Availability',
        body: 'The Host agrees to keep availability reasonably accurate and to honour bookings accepted through StayGuwahati, subject to legitimate cancellation circumstances and the published property policy. The Host must not knowingly accept overlapping reservations for the same accommodation dates.'
    },
    {
        title: '7. Cancellation, Refunds and Guest Issues',
        body: 'The Host is responsible for accommodation-side cancellations, refunds, check-in arrangements, property issues, and guest communications relating to the stay. Any refund owed to a guest for a direct payment is the Host\'s responsibility. StayGuwahati may assist with communication and platform support but does not become the guest\'s accommodation payment custodian.'
    },
    {
        title: '8. Safety, Legality and Compliance',
        body: 'The Host is responsible for ensuring that the property and its operation comply with applicable local, state, and national requirements, including any permissions, registrations, taxes, safety requirements, building rules, and guest-identification requirements that apply to the property.'
    },
    {
        title: '9. Platform Standards',
        body: 'StayGuwahati may review listings, request supporting information, suspend a listing, or remove a listing where information is materially inaccurate, a safety concern is reported, the Host breaches this agreement, or continued listing is otherwise inconsistent with platform requirements.'
    },
    {
        title: '10. Host Responsibility and Indemnity',
        body: 'The Host remains responsible for the property, services supplied to guests, and claims arising from the Host\'s acts or omissions. To the extent permitted by applicable law, the Host agrees to protect StayGuwahati from losses, claims, penalties, or costs arising from the Host\'s breach of this agreement or unlawful operation of the property.'
    },
    {
        title: '11. Privacy and Guest Data',
        body: 'The Host must use guest information only for legitimate booking, check-in, safety, support, and legal purposes and must take reasonable steps to protect that information from unauthorized access or disclosure.'
    },
    {
        title: '12. Termination',
        body: 'Either party may discontinue the partnership subject to any outstanding booking, payment, refund, dispute, or commission obligations. StayGuwahati may suspend or terminate access immediately where necessary to address fraud, safety, serious policy violations, or legal requirements.'
    },
    {
        title: '13. Changes to Terms',
        body: 'StayGuwahati may publish updated partnership terms for future bookings. Material changes will be presented to Hosts where required. A new agreement version may be required before continued use of the platform.'
    },
    {
        title: '14. Electronic Acceptance',
        body: 'By selecting “I Agree & Accept”, the Host confirms that the Host has read this agreement, understands its terms, and voluntarily accepts it electronically. The platform records the Host account, agreement version, applicable commission rate, acceptance date/time, and technical acceptance details for its records.'
    },
    {
        title: '15. Governing Law and Disputes',
        body: 'This partnership is subject to the laws applicable in India. The parties will first attempt to resolve disputes through good-faith communication. Nothing in this agreement limits rights or remedies that cannot lawfully be excluded.'
    }
];

function agreementHostEmail(user) {
    return String(user?.email || '').trim().toLowerCase();
}

async function getOrCreateHostAgreement(user) {
    if (!user?.userId || !mongoose.Types.ObjectId.isValid(String(user.userId))) return null;
    let agreement = await HostAgreement.findOne({ userId: user.userId });
    if (!agreement) {
        agreement = await HostAgreement.create({
            userId: user.userId,
            hostName: String(user.name || '').trim(),
            hostEmail: agreementHostEmail(user),
            version: HOST_AGREEMENT_VERSION,
            status: 'pending',
            acceptanceMethod: 'i_agree_accept'
        });
    } else if (agreement.status !== 'accepted') {
        const updates = {};
        if (!agreement.hostName && user.name) updates.hostName = String(user.name).trim();
        if (!agreement.hostEmail && user.email) updates.hostEmail = agreementHostEmail(user);
        if (Object.keys(updates).length) {
            Object.assign(agreement, updates);
            await agreement.save();
        }
    }
    return agreement;
}

async function assignAgreementCommissionRate(user, agreement) {
    if (agreement.commissionRate !== null && agreement.commissionRate !== undefined && Number.isFinite(Number(agreement.commissionRate))) {
        return Number(agreement.commissionRate);
    }

    const hostEmail = agreementHostEmail(user);
    const explicitProperty = hostEmail
        ? await Homestay.findOne({
            $or: [{ ownerEmail: hostEmail }, { 'host.email': hostEmail }, { hostEmail }],
            commissionRate: { $exists: true, $ne: null }
        }).select('commissionRate').lean()
        : null;

    if (explicitProperty && Number.isFinite(Number(explicitProperty.commissionRate)) && Number(explicitProperty.commissionRate) >= 0) {
        agreement.commissionRate = Number(explicitProperty.commissionRate);
        return agreement.commissionRate;
    }

    const foundingAccepted = await HostAgreement.countDocuments({
        status: 'accepted',
        commissionRate: FOUNDING_HOST_COMMISSION_RATE,
        _id: { $ne: agreement._id }
    });

    agreement.commissionRate = foundingAccepted < FOUNDING_HOST_LIMIT
        ? FOUNDING_HOST_COMMISSION_RATE
        : STANDARD_HOST_COMMISSION_RATE;
    return agreement.commissionRate;
}

async function buildSettlementSnapshot(booking, persist = true) {
    const status = String(booking?.status || '').trim().toLowerCase();
    const property = booking?.homestayId && typeof booking.homestayId === 'object'
        ? booking.homestayId
        : (booking?.propertyId && mongoose.Types.ObjectId.isValid(String(booking.propertyId)) ? await Homestay.findById(booking.propertyId).lean() : null);
    const bookingValue = Math.max(0, Number(booking?.totalPrice || 0));
    const commissionBase = ['confirmed', 'completed', 'accepted', 'approved'].includes(status) ? bookingValue : 0;
    const hasSavedRate = booking?.commissionRate !== undefined && booking?.commissionRate !== null && booking?.commissionRate !== '';
    const existingRate = Number(booking?.commissionRate);
    const rate = hasSavedRate && Number.isFinite(existingRate) && existingRate >= 0 ? existingRate : await resolveHostCommissionRate(property || { hostEmail: booking?.hostEmail });
    const commissionAmount = Number((commissionBase * rate / 100).toFixed(2));
    const hasSavedTaxRate = booking?.commissionTaxRate !== undefined && booking?.commissionTaxRate !== null && booking?.commissionTaxRate !== '';
    const taxRate = hasSavedTaxRate && Number.isFinite(Number(booking.commissionTaxRate)) && Number(booking.commissionTaxRate) >= 0 ? Number(booking.commissionTaxRate) : COMMISSION_TAX_RATE;
    const taxAmount = Number((commissionAmount * taxRate / 100).toFixed(2));
    const commissionTotal = Number((commissionAmount + taxAmount).toFixed(2));
    const paidAmount = Math.max(0, Number(booking?.settlementPaidAmount || 0));
    let settlementStatus = String(booking?.settlementStatus || '').toLowerCase();
    if (!commissionTotal) settlementStatus = 'not_due';
    else if (paidAmount >= commissionTotal) settlementStatus = 'paid';
    else if (paidAmount > 0) settlementStatus = 'partially_paid';
    else if (settlementStatus !== 'disputed') settlementStatus = 'pending';
    const snapshot = { commissionRate: rate, commissionBase, commissionAmount, commissionTaxRate: taxRate, commissionTaxAmount: taxAmount, commissionTotal, settlementStatus, paymentMethod: 'direct_to_host' };
    if (persist && commissionBase > 0 && (booking.commissionRate == null || Number(booking.commissionBase || 0) !== commissionBase || Number(booking.commissionAmount || 0) !== commissionAmount || Number(booking.commissionTaxRate || 0) !== taxRate || Number(booking.commissionTaxAmount || 0) !== taxAmount || Number(booking.commissionTotal || 0) !== commissionTotal || String(booking.settlementStatus || '').toLowerCase() !== settlementStatus)) {
        Object.assign(booking, snapshot);
        await booking.save();
    }
    return { ...snapshot, bookingValue, paidAmount, outstandingAmount: Number(Math.max(0, commissionTotal - paidAmount).toFixed(2)) };
}

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

// 3.9 Host Partnership Agreement
app.get('/api/host-agreement', authenticateToken, async (req, res) => {
    try {
        const agreement = await getOrCreateHostAgreement(req.user);
        if (!agreement) return res.status(400).json({ success: false, message: 'Unable to identify the host account.' });

        return res.json({
            success: true,
            data: {
                agreement: agreement.toObject(),
                version: HOST_AGREEMENT_VERSION,
                terms: HOST_AGREEMENT_TERMS,
                config: {
                    foundingHostLimit: FOUNDING_HOST_LIMIT,
                    foundingHostCommissionRate: FOUNDING_HOST_COMMISSION_RATE,
                    standardCommissionRate: STANDARD_HOST_COMMISSION_RATE,
                    commissionTaxRate: COMMISSION_TAX_RATE,
                    guestPayment: 'direct_to_host'
                }
            }
        });
    } catch (error) {
        console.error('[HOST AGREEMENT] Fetch error:', error);
        return res.status(500).json({ success: false, message: 'Unable to load the Host Partnership Agreement.' });
    }
});

app.post('/api/host-agreement/accept', authenticateToken, async (req, res) => {
    try {
        const agreement = await getOrCreateHostAgreement(req.user);
        if (!agreement) return res.status(400).json({ success: false, message: 'Unable to identify the host account.' });

        if (agreement.status === 'accepted') {
            return res.json({ success: true, message: 'Host Partnership Agreement is already accepted.', data: agreement });
        }

        if (String(req.body?.agreementVersion || '') !== HOST_AGREEMENT_VERSION) {
            return res.status(409).json({ success: false, message: 'This agreement version is no longer current. Please reload the agreement.' });
        }

        const confirmed = req.body?.confirmed === true;
        if (!confirmed) {
            return res.status(400).json({ success: false, message: 'Please confirm that you have read and agree to the Host Partnership Agreement.' });
        }

        const commissionRate = await assignAgreementCommissionRate(req.user, agreement);
        agreement.version = HOST_AGREEMENT_VERSION;
        agreement.hostName = String(req.user?.name || agreement.hostName || '').trim();
        agreement.hostEmail = agreementHostEmail(req.user) || agreement.hostEmail;
        agreement.status = 'accepted';
        agreement.acceptedAt = new Date();
        agreement.acceptanceMethod = 'i_agree_accept';
        agreement.ipAddress = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
        agreement.userAgent = String(req.headers['user-agent'] || '').slice(0, 1000);
        agreement.commissionRate = commissionRate;
        await agreement.save();

        return res.json({
            success: true,
            message: 'Host Partnership Agreement accepted successfully.',
            data: agreement
        });
    } catch (error) {
        console.error('[HOST AGREEMENT] Acceptance error:', error);
        return res.status(500).json({ success: false, message: 'Unable to record agreement acceptance.' });
    }
});

app.get('/api/admin/host-agreements', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const status = String(req.query.status || 'all').trim().toLowerCase();
        const query = status !== 'all' ? { status } : {};
        const agreements = await HostAgreement.find(query).sort({ acceptedAt: -1, updatedAt: -1 }).lean();
        const accepted = agreements.filter((a) => a.status === 'accepted');
        const foundingAccepted = accepted.filter((a) => Number(a.commissionRate) === FOUNDING_HOST_COMMISSION_RATE).length;
        return res.json({
            success: true,
            data: agreements,
            config: {
                version: HOST_AGREEMENT_VERSION,
                foundingHostLimit: FOUNDING_HOST_LIMIT,
                foundingHostCommissionRate: FOUNDING_HOST_COMMISSION_RATE,
                standardCommissionRate: STANDARD_HOST_COMMISSION_RATE,
                acceptedCount: accepted.length,
                foundingAcceptedCount: foundingAccepted
            }
        });
    } catch (error) {
        console.error('[ADMIN HOST AGREEMENTS] Fetch error:', error);
        return res.status(500).json({ success: false, message: 'Unable to load host partnership agreements.' });
    }
});

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

// Check whether a property's requested dates overlap an existing active booking.
app.get('/api/bookings/availability', async (req, res) => {
    try {
        const { propertyId, checkIn, checkOut } = req.query;

        if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
            return res.status(400).json({
                success: false,
                message: 'A valid property ID is required.'
            });
        }

        const parsedCheckIn = new Date(String(checkIn || ''));
        const parsedCheckOut = new Date(String(checkOut || ''));

        if (
            isNaN(parsedCheckIn.getTime()) ||
            isNaN(parsedCheckOut.getTime()) ||
            parsedCheckOut <= parsedCheckIn
        ) {
            return res.status(400).json({
                success: false,
                message: 'Please select valid check-in and check-out dates.'
            });
        }

        const conflict = await Booking.findOne({
            $or: [
                { homestayId: propertyId },
                { propertyId: propertyId }
            ],
            status: { $in: ['Requested', 'Confirmed'] },
            checkInDate: { $lt: parsedCheckOut },
            checkOutDate: { $gt: parsedCheckIn }
        }).select('_id checkInDate checkOutDate status');

        return res.json({
            success: true,
            available: !conflict
        });
    } catch (error) {
        console.error('Availability check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to check date availability.'
        });
    }
});

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
        const acceptedHostAgreement = hostEmail
            ? await HostAgreement.findOne({ hostEmail, status: 'accepted' }).select('commissionRate').lean()
            : null;
        const bookingCommissionRate = acceptedHostAgreement && Number.isFinite(Number(acceptedHostAgreement.commissionRate))
            ? Number(acceptedHostAgreement.commissionRate)
            : await resolveHostCommissionRate(property);
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
            paymentMethod: 'direct_to_host',
            commissionRate: bookingCommissionRate,
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
        // Snapshot the applicable commission when a booking is confirmed.
        // The guest still pays the host directly; this only records the host's
        // StayGuwahati commission obligation for historical statements.
        if (newStatus === 'Confirmed') {
            const settlement = await buildSettlementSnapshot(booking, false);
            Object.assign(booking, {
                ...settlement,
                paymentMethod: 'direct_to_host',
                paymentStatus: 'unpaid'
            });
        }
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

// Admin host commission / settlement statement
app.get('/api/admin/settlements', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { host, status, from, to } = req.query;
        const query = {};
        if (host) query.hostEmail = String(host).trim().toLowerCase();
        if (from || to) { query.createdAt = {}; if (from) query.createdAt.$gte = new Date(String(from)); if (to) { const d = new Date(String(to)); if (!Number.isNaN(d.getTime())) { d.setHours(23,59,59,999); query.createdAt.$lte = d; } } }
        const bookings = await Booking.find(query).populate('homestayId').sort({ createdAt: -1 });
        const data = [];
        for (const booking of bookings) {
            const s = await buildSettlementSnapshot(booking);
            if (status && String(status).toLowerCase() !== 'all' && s.settlementStatus !== String(status).toLowerCase()) continue;
            data.push({ ...booking.toObject(), settlement: s });
        }
        const summary = data.reduce((a, x) => { const s=x.settlement||{}; a.bookingValue+=Number(s.bookingValue||0); a.commission+=Number(s.commissionAmount||0); a.tax+=Number(s.commissionTaxAmount||0); a.totalDue+=Number(s.commissionTotal||0); a.paid+=Number(s.paidAmount||0); a.outstanding+=Number(s.outstandingAmount||0); return a; }, {bookingValue:0,commission:0,tax:0,totalDue:0,paid:0,outstanding:0});
        return res.json({ success:true, config:{foundingHostLimit:FOUNDING_HOST_LIMIT,foundingHostCommissionRate:FOUNDING_HOST_COMMISSION_RATE,standardCommissionRate:STANDARD_HOST_COMMISSION_RATE,commissionTaxRate:COMMISSION_TAX_RATE,guestPayment:'direct_to_host'}, summary, data });
    } catch (error) { console.error('[ADMIN SETTLEMENTS] Fetch error:', error); return res.status(500).json({success:false,message:'Unable to load host settlement statements.'}); }
});

app.patch('/api/admin/settlements/:id/payment', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({success:false,message:'Invalid Booking ID.'});
        const booking = await Booking.findById(req.params.id).populate('homestayId');
        if (!booking) return res.status(404).json({success:false,message:'Booking not found.'});
        const s = await buildSettlementSnapshot(booking);
        const amount = Number(req.body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({success:false,message:'A valid payment amount is required.'});
        const currentPaid = Math.max(0, Number(booking.settlementPaidAmount || 0));
        const newPaid = Number((currentPaid + amount).toFixed(2));
        if (newPaid > s.commissionTotal + 0.01) return res.status(400).json({success:false,message:`Payment exceeds outstanding amount of ₹${Math.max(0,s.commissionTotal-currentPaid).toFixed(2)}.`});
        booking.settlementPaidAmount = newPaid;
        booking.settlementPaymentDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();
        booking.settlementPaymentMethod = String(req.body.paymentMethod || 'bank_transfer').trim();
        booking.settlementTransactionReference = String(req.body.transactionReference || '').trim();
        booking.settlementNotes = String(req.body.notes || '').trim();
        booking.settlementStatus = newPaid >= s.commissionTotal ? 'paid' : 'partially_paid';
        await booking.save();
        return res.json({success:true,message:booking.settlementStatus==='paid'?'Settlement marked as paid.':'Partial settlement recorded.',data:booking});
    } catch (error) { console.error('[ADMIN SETTLEMENTS] Payment update error:', error); return res.status(500).json({success:false,message:'Unable to record settlement payment.'}); }
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
                                url: optimizeCloudinaryUrl(cloudResult.url, { width: 1600 }),
                                originalUrl: cloudResult.url,
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

        const listings = await Homestay.find(queryFilter).sort({ createdAt: -1 }).lean(); //[cite: 7]

        const optimizedListings = listings.map(listing => ({
            ...listing,
            images: optimizePropertyImages(listing.images, 800),
            photos: optimizePropertyImages(listing.photos, 800),
            imageUrl: optimizeImageUrl(listing.imageUrl, 800),
            image: optimizeImageUrl(listing.image, 800),
            host: listing.host
                ? {
                    ...listing.host,
                    avatar: optimizeImageUrl(listing.host.avatar, 400)
                }
                : listing.host
        }));

        res.status(200).json({ success: true, count: optimizedListings.length, data: optimizedListings }); //[cite: 7]
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

        // Optimize existing Cloudinary images on delivery.
        // The database continues to keep the original URLs.
        homestay.images = optimizePropertyImages(homestay.images, 1600);
        homestay.photos = optimizePropertyImages(homestay.photos, 1600);
        homestay.imageUrl = optimizeImageUrl(homestay.imageUrl, 1600);
        homestay.image = optimizeImageUrl(homestay.image, 1600);

        if (homestay.host) {
            homestay.host.avatar = optimizeImageUrl(homestay.host.avatar, 400);
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
app.listen(PORT, () => {
    console.log(`StayGuwahati Core Engine running on port ${PORT}`); //[cite: 7]
});