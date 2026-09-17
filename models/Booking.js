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
    nightlyRate: { type: Number, default: 0 },
    guests: { type: Number, default: 1 },
    specialRequests: { type: String, default: '' },

    // StayGuwahati direct-to-host settlement snapshot. These values are
    // captured for each booking so later commission changes do not alter
    // historical statements.
    paymentMethod: { type: String, default: 'direct_to_host' },
    paymentStatus: { type: String, default: 'unpaid' },
    commissionRate: { type: Number, default: null },
    commissionBase: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    commissionTaxRate: { type: Number, default: null },
    commissionTaxAmount: { type: Number, default: 0 },
    commissionTotal: { type: Number, default: 0 },
    settlementStatus: { type: String, default: 'pending' },
    settlementPaidAmount: { type: Number, default: 0 },
    settlementPaymentDate: { type: Date, default: null },
    settlementPaymentMethod: { type: String, default: '' },
    settlementTransactionReference: { type: String, default: '' },
    settlementNotes: { type: String, default: '' },

    status: { type: String, default: 'Confirmed' },
    reviewToken: { type: String },
    reviewSubmitted: { type: Boolean, default: false },
    reviewEmailSent: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);