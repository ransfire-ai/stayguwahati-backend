const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referralCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },

    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    referrerName: { type: String, required: true, trim: true },
    referrerEmail: { type: String, required: true, lowercase: true, trim: true },

    hostUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    hostName: { type: String, required: true, trim: true },
    hostPhone: { type: String, required: true, trim: true },
    hostEmail: { type: String, required: true, lowercase: true, trim: true, index: true },

    message: { type: String, default: '', maxlength: 2000 },

    status: {
      type: String,
      enum: ['pending', 'invited', 'registered', 'property_listed', 'eligible', 'completed', 'rejected', 'expired'],
      default: 'pending',
      index: true
    },

    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Homestay',
      default: null,
      index: true
    },

    firstEligibleBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },

    rewardAmount: { type: Number, default: 1000, min: 0 },
    referrerRewardStatus: {
      type: String,
      enum: ['pending', 'earned', 'paid', 'cancelled'],
      default: 'pending'
    },
    hostRewardStatus: {
      type: String,
      enum: ['pending', 'earned', 'paid', 'cancelled'],
      default: 'pending'
    },

    invitedAt: { type: Date, default: null },
    registeredAt: { type: Date, default: null },
    propertyListedAt: { type: Date, default: null },
    rewardEarnedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

referralSchema.index({ hostEmail: 1, status: 1 });
referralSchema.index({ referrerEmail: 1, createdAt: -1 });

module.exports = mongoose.model('Referral', referralSchema);
