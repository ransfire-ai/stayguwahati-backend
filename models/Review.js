const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    propertyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Homestay',
        required: true
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking'
    },
    guestName: {
        type: String,
        default: 'Verified Guest'
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true,
        trim: true
    }
}, { timestamps: true });

// One verified review per booking.
// Partial index keeps older reviews without bookingId valid while preventing
// duplicate reviews for the same genuine booking.
reviewSchema.index(
    { bookingId: 1 },
    {
        unique: true,
        partialFilterExpression: { bookingId: { $exists: true, $ne: null } }
    }
);

module.exports = mongoose.model('Review', reviewSchema);