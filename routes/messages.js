const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();

// 1. Updated Message Schema matching the frontend payload
const messageSchema = new mongoose.Schema({
    guestName: { type: String, required: true },
    propertyTitle: { type: String, required: true },
    senderName: { type: String, required: true },
    message: { type: String, required: true },
    recipientPhone: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// 2. GET: Fetch messages filtered by guest and property title
router.get('/messages', async (req, res) => {
    try {
        const { guestName, propertyTitle } = req.query;
        let query = {};
        if (guestName) query.guestName = guestName;
        if (propertyTitle) query.propertyTitle = propertyTitle;

        const messages = await Message.find(query).sort({ createdAt: 1 });
        res.json({ success: true, data: messages });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. POST: Save and send a new message
router.post('/messages/send', async (req, res) => {
    try {
        const { propertyTitle, guestName, senderName, message, recipientPhone } = req.body;
        
        const newMessage = new Message({
            propertyTitle,
            guestName,
            senderName,
            message,
            recipientPhone: recipientPhone || ''
        });

        await newMessage.save();
        res.status(201).json({ success: true, data: newMessage });
    } catch (err) {
        console.error("Error saving message:", err);
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = router;