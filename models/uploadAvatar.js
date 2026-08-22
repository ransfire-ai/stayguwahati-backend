const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const path = require('path');

// Load backend/.env
require('dotenv').config({
    path: path.resolve(__dirname, '../.env')
});

const Homestay = require('./Homestay');

// Configure Cloudinary from .env
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function updateHostAvatar() {
    if (!MONGO_URI || !MONGO_URI.startsWith('mongodb')) {
        console.error('❌ Invalid or missing MONGO_URI.');
        console.error('Check backend/.env');
        process.exit(1);
    }

    if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
    ) {
        console.error('❌ Cloudinary credentials are missing from .env');
        process.exit(1);
    }

    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Upload avatar to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500',
            {
                folder: 'stayguwahati/hosts',
                public_id: 'moitreyee_devi_avatar',
                overwrite: true
            }
        );

        console.log('✅ Cloudinary Upload URL:');
        console.log(uploadResult.secure_url);

        // Update Moitreyee Devi's homestay records
        const updated = await Homestay.updateMany(
            { 'host.email': 'ransfire@gmail.com' },
            {
                $set: {
                    'host.avatar': uploadResult.secure_url
                }
            }
        );

        console.log('');
        console.log('Matched records:', updated.matchedCount);
        console.log('Modified records:', updated.modifiedCount);

        if (updated.matchedCount === 0) {
            console.log(
                '❌ No homestay found with host.email = ransfire@gmail.com'
            );
        } else if (updated.modifiedCount === 0) {
            console.log(
                '⚠️ Homestay found, but avatar was already set to this value.'
            );
        } else {
            console.log(
                '✅ Host avatar successfully saved to MongoDB!'
            );
        }

    } catch (error) {
        console.error('❌ Error during update:');
        console.error(error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected.');
        process.exit();
    }
}

updateHostAvatar();