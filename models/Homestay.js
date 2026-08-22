const mongoose = require('mongoose');

// Helper to generate a default initial avatar URL using host name
function generateDefaultAvatar(name) {
    const formattedName = encodeURIComponent(name || 'Host');
    return `https://ui-avatars.com/api/?name=${formattedName}&background=0d9488&color=fff&size=128`;
}

const homestaySchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: [true, 'Homestay title is required'], 
        trim: true 
    },
    locality: { 
        type: String, 
        required: [true, 'Locality within Guwahati is required'],
        enum: [
            'Amingaon', 'Azara', 'Bamunimaidam', 'Basistha', 'Beltola', 
            'Bhangagarh', 'Borjhar', 'Chandmari', 'Christian Basti', 'Dispur', 
            'Ganeshguri', 'Geetanagar', 'GS Road', 'Jalukbari', 'Kahilipara', 
            'Kamakhya', 'Khanapara', 'Kharghuli', 'Lal Ganesh', 'Lokhra', 
            'Maligaon', 'Narengi', 'Paltan Bazar', 'Pan Bazar', 'Rehabari', 
            'Rukminigaon', 'Silpukhuri', 'Six Mile', 'Supermarket', 
            'Ulubari', 'Uzan Bazar', 'Zoo Road'
        ],
        index: true 
    },
    description: { 
        type: String, 
        required: true 
    },
    pricePerNight: { 
        type: Number, 
        required: [true, 'Price per night is required'],
        index: true
    },
    lat: {
        type: Number,
        required: [true, 'Latitude coordinate is required']
    },
    lng: {
        type: Number,
        required: [true, 'Longitude coordinate is required']
    },
    rating: { 
        type: Number, 
        default: 5.0,
        min: 0,
        max: 5 
    },
    reviewsCount: { 
        type: Number, 
        default: 0 
    },
    images: [{ 
        type: String, 
        required: true 
    }],
    features: [{ 
        type: String 
    }],
    host: {
        name: { type: String, required: true },
        email: { 
            type: String, 
            required: [true, 'Host email is required for listing ownership'], 
            lowercase: true, 
            trim: true,
            index: true 
        },
        phone: { type: String, required: true },
        avatar: { 
            type: String, 
            trim: true, 
            default: function() {
                return generateDefaultAvatar(this.name);
            },
            get: function(v) {
                return (v && v.trim() !== '') ? v : generateDefaultAvatar(this.name);
            }
        },
        isVerified: { type: Boolean, default: false }
    },
    isAvailable: { 
        type: Boolean, 
        default: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected'], 
        default: 'pending',
        lowercase: true,
        index: true
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true }
});

// Middleware to ensure avatar field is never stored as empty string prior to saving
homestaySchema.pre('save', function(next) {
    if (this.host && (!this.host.avatar || this.host.avatar.trim() === '')) {
        this.host.avatar = generateDefaultAvatar(this.host.name);
    }
    next();
});

// Virtual helper so p.price works on the frontend
homestaySchema.virtual('price').get(function() {
    return this.pricePerNight;
});

// Virtual helper so p.image works on the frontend
homestaySchema.virtual('image').get(function() {
    return this.images && this.images.length > 0 ? this.images[0] : null;
});

// Virtual helper so p.hostEmail works on the frontend
homestaySchema.virtual('hostEmail').get(function() {
    return this.host ? this.host.email : null;
});

// Virtual helper so p.hostAvatar works on the frontend
homestaySchema.virtual('hostAvatar').get(function() {
    if (this.host && this.host.avatar && this.host.avatar.trim() !== '') {
        return this.host.avatar;
    }
    return generateDefaultAvatar(this.host ? this.host.name : 'Host');
});

module.exports = mongoose.model('Homestay', homestaySchema);