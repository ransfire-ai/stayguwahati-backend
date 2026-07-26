const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    propertyTitle: { type: String, required: true },
    guestName: { type: String, required: true },
    senderName: { type: String, required: true },
    message: { type: String, required: true },
    recipientPhone: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);