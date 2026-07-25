const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();

// 1. Message Schema
const messageSchema = new mongoose.Schema({
    guestName: { type: String, required: true },
    propertyName: { type: String, required: true },
    sender: { type: String, enum: ['host', 'guest'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// 2. GET: Fetch messages for a specific guest/property thread
router.get('/api/messages/:guestName', async (req, res) => {
    try {
        const messages = await Message.find({ guestName: req.params.guestName }).sort({ timestamp: 1 });
        res.json({ success: true, data: messages });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. POST: Send and save a new message
router.post('/api/messages', async (req, res) => {
    try {
        const { guestName, propertyName, sender, text } = req.body;
        const newMessage = new Message({ guestName, propertyName, sender, text });
        await newMessage.save();
        res.status(201).json({ success: true, data: newMessage });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;