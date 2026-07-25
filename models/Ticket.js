// models/Ticket.js
const mongoose = require('mongoose');

const TicketSchema = new mongoose.Schema({
    description: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ticket', TicketSchema);