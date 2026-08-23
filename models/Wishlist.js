const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        propertyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Homestay',
            required: true,
            index: true
        }
    },
    { timestamps: true }
);

// A user can save a property only once.
wishlistSchema.index({ userId: 1, propertyId: 1 }, { unique: true });

module.exports = mongoose.model('Wishlist', wishlistSchema);
