const mongoose = require('mongoose');

// Helper to generate a default initial avatar URL using host name
function generateDefaultAvatar(name) {
    const formattedName = encodeURIComponent(name || 'Host');

    return `https://ui-avatars.com/api/?name=${formattedName}&background=0d9488&color=fff&size=128`;
}

const homestaySchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, 'Homestay title is required'],
            trim: true
        },

        locality: {
            type: String,
            required: [true, 'Locality within Guwahati is required'],
            enum: [
                'Amingaon',
                'Azara',
                'Bamunimaidam',
                'Basistha',
                'Beltola',
                'Bhangagarh',
                'Borjhar',
                'Chandmari',
                'Christian Basti',
                'Dispur',
                'Ganeshguri',
                'Geetanagar',
                'GS Road',
                'Jalukbari',
                'Kahilipara',
                'Kamakhya',
                'Khanapara',
                'Kharghuli',
                'Lal Ganesh',
                'Lokhra',
                'Maligaon',
                'Narengi',
                'Paltan Bazar',
                'Pan Bazar',
                'Rehabari',
                'Rukminigaon',
                'Silpukhuri',
                'Six Mile',
                'Supermarket',
                'Ulubari',
                'Uzan Bazar',
                'Zoo Road'
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

        // Number of bedrooms available to guests.
        bedrooms: {
            type: Number,
            required: [true, 'Number of bedrooms is required'],
            min: [1, 'At least one bedroom is required'],
            max: [20, 'Maximum 20 bedrooms allowed']
        },

        // Bathroom breakdown used by the listing form.
        bathrooms: {
            privateAttached: {
                type: Number,
                default: 0,
                min: 0,
                max: 20
            },
            dedicated: {
                type: Number,
                default: 0,
                min: 0,
                max: 20
            },
            shared: {
                type: Number,
                default: 0,
                min: 0,
                max: 20
            },
            total: {
                type: Number,
                default: 0,
                min: 0,
                max: 60
            }
        },

        cancellationPolicy: {
            type: String,
            enum: ['flexible', 'moderate', 'strict'],
            default: 'flexible',
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

        images: [
            {
                type: String,
                required: true
            }
        ],

        features: [
            {
                type: String
            }
        ],

        host: {
            name: {
                type: String,
                required: true,
                trim: true
            },

            email: {
                type: String,
                required: [true, 'Host email is required for listing ownership'],
                lowercase: true,
                trim: true,
                index: true
            },

            phone: {
                type: String,
                required: true
            },

            // IMPORTANT:
            // Do NOT use a Mongoose getter/default here.
            // The actual Cloudinary URL stored in MongoDB
            // should be returned exactly as it is.
            avatar: {
                type: String,
                trim: true
            },

            isVerified: {
                type: Boolean,
                default: false
            }
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
    },
    {
        timestamps: true,

        // Keep virtual fields available in API responses.
        // We are intentionally NOT enabling getters globally
        // because avatar no longer needs a Mongoose getter.
        toJSON: {
            virtuals: true
        },

        toObject: {
            virtuals: true
        }
    }
);


// ============================================================
// DEFAULT AVATAR FALLBACK
// ============================================================
//
// Only create a default avatar when host.avatar is genuinely
// missing or empty.
//
// This will NOT overwrite an existing Cloudinary URL.
//

homestaySchema.pre('save', function () {
    if (
        this.host &&
        (
            !this.host.avatar ||
            typeof this.host.avatar !== 'string' ||
            this.host.avatar.trim() === ''
        )
    ) {
        this.host.avatar = generateDefaultAvatar(
            this.host.name || 'Host'
        );
    }
});


// ============================================================
// VIRTUAL: price
// ============================================================

homestaySchema.virtual('price').get(function () {
    return this.pricePerNight;
});


// ============================================================
// VIRTUAL: image
// ============================================================

homestaySchema.virtual('image').get(function () {
    return (
        this.images &&
        this.images.length > 0
    )
        ? this.images[0]
        : null;
});


// ============================================================
// VIRTUAL: hostEmail
// ============================================================

homestaySchema.virtual('hostEmail').get(function () {
    return this.host
        ? this.host.email
        : null;
});


// ============================================================
// VIRTUAL: hostAvatar
// ============================================================
//
// Returns the real Cloudinary avatar if available.
// Otherwise generates the initials avatar.
//

homestaySchema.virtual('hostAvatar').get(function () {
    if (
        this.host &&
        this.host.avatar &&
        typeof this.host.avatar === 'string' &&
        this.host.avatar.trim() !== ''
    ) {
        return this.host.avatar;
    }

    return generateDefaultAvatar(
        this.host && this.host.name
            ? this.host.name
            : 'Host'
    );
});


module.exports = mongoose.model('Homestay', homestaySchema);