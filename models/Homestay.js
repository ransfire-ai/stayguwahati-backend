const mongoose = require('mongoose');

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
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
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

module.exports = mongoose.model('Homestay', homestaySchema);