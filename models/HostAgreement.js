const mongoose = require('mongoose');

const hostAgreementSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    hostName: { type: String, default: '' },
    hostEmail: { type: String, default: '', lowercase: true, index: true },
    version: { type: String, required: true, default: 'SG-2026-01' },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending', index: true },
    commissionRate: { type: Number, default: null },
    acceptanceMethod: { type: String, default: 'i_agree_accept' },
    acceptedAt: { type: Date, default: null },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('HostAgreement', hostAgreementSchema);
