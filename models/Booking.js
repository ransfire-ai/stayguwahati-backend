const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Homestay', required: true },
    homestayId: { type: mongoose.Schema.Types.ObjectId, ref: 'Homestay', required: true },
    propertyName: { type: String, required: true },
    dates: { type: String, required: true },
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    hostEmail: { type: String },
    nights: { type: Number, default: 1 },
    totalPrice: { type: Number, default: 0 },
    status: { type: String, default: 'Confirmed' },
    reviewToken: { type: String },
    reviewSubmitted: { type: Boolean, default: false },
    reviewEmailSent: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);