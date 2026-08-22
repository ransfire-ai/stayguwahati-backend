const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const path = require('path');

// Loads environment variables from the parent backend/.env file
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Homestay = require('./Homestay');

// Configure Cloudinary
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'mhujdmb2', 
    api_key: process.env.CLOUDINARY_API_KEY || '756479923117269', 
    api_secret: process.env.CLOUDINARY_API_SECRET || '3q85x6xXgc4XCh60A_-0X3rMxB8'
});

// Retrieves Mongo URI from your .env
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function updateHostAvatar() {
    if (!MONGO_URI || !MONGO_URI.startsWith('mongodb')) {
        console.error('\nError: Invalid or missing MONGO_URI connection string.');
        console.error('Ensure process.env.MONGO_URI in your backend/.env file starts with mongodb:// or mongodb+srv://\n');
        process.exit(1);
    }

    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB...');

        // Upload photo to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500', 
            {
                folder: 'stayguwahati/hosts',
                public_id: 'moitreyee_devi_avatar'
            }
        );

        console.log('Cloudinary Upload URL:', uploadResult.secure_url);

        // Update database directly for host Moitreyee Devi
        const updated = await Homestay.updateMany(
            { "host.email": "ransfire@gmail.com" },
            { $set: { "host.avatar": uploadResult.secure_url } }
        );

        console.log(`Successfully updated ${updated.modifiedCount} homestay record(s) in MongoDB!`);

    } catch (error) {
        console.error('Error during update:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

updateHostAvatar();