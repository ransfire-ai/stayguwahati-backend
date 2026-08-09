const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String },
    propertyName: { type: String },
    dates: { type: String, required: true }, // Legacy/display string format[cite: 4]
    
    // --- REQUIRED FOR PREVENTING OVERLAPPING BOOKINGS ---
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    nights: { type: Number, default: 1 },

    totalPrice: { type: Number },
    status: { 
        type: String, 
        enum: ['Confirmed', 'Pending', 'Cancelled', 'Completed'], 
        default: 'Confirmed' 
    },

    // Reference to the Homestay listing
    homestayId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Homestay',
        required: true 
    },
    propertyId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Homestay' 
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Useful for filtering host-specific incoming bookings directly
    hostEmail: { type: String, lowercase: true, trim: true },

    // --- NEW FIELDS FOR VERIFIED REVIEWS ---
    reviewSubmitted: { type: Boolean, default: false },
    reviewToken: { type: String, required: true, unique: true },

    createdAt: { type: Date, default: Date.now }
});

// --- DATABASE INDEX TO PREVENT SIMULTANEOUS DUPLICATE BOOKINGS ---
bookingSchema.index({ homestayId: 1, checkInDate: 1 }, { unique: true });

module.exports = mongoose.model('Booking', bookingSchema);
```[cite: 4]