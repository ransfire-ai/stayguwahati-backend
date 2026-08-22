import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({ 
    cloud_name: 'mhujdmb2', 
    api_key: '756479923117269', 
    api_secret: '3q85x6xXgc4XCh60A_-0X3rMxB8' // Replace with your actual secret from Cloudinary dashboard
});

(async function() {
    try {
        // Pass either a local file path (e.g., './moitreyee.jpg') or an existing image URL
        const uploadResult = await cloudinary.uploader.upload('./moitreyee.jpg', {
            folder: 'stayguwahati/hosts',
            public_id: 'moitreyee_devi_avatar',
            transformation: [
                { width: 300, height: 300, crop: 'thumb', gravity: 'face' } // Auto-crops to a square centered on face
            ]
        });

        console.log("\n================ COPY THIS URL ================");
        console.log(uploadResult.secure_url);
        console.log("===============================================\n");

    } catch (error) {
        console.error("Upload Error:", error);
    }
})();