const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String },
    propertyName: { type: String },
    dates: { type: String, required: true },
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
    // Useful for filtering host-specific incoming bookings directly
    hostEmail: { type: String, lowercase: true, trim: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema);