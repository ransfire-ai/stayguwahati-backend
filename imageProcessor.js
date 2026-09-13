const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * StayGuwahati Image Processor
 *
 * Creates optimized WebP versions of property photos.
 *
 * Main image:
 *   max width: 1600px
 *   quality: 80
 *
 * Medium:
 *   max width: 1000px
 *   quality: 78
 *
 * Thumbnail:
 *   max width: 600px
 *   quality: 75
 */

async function processImage(inputPath, outputDirectory) {
    if (!inputPath) {
        throw new Error('Image input path is required.');
    }

    if (!fs.existsSync(inputPath)) {
        throw new Error(`Image file not found: ${inputPath}`);
    }

    if (!fs.existsSync(outputDirectory)) {
        await fs.promises.mkdir(outputDirectory, {
            recursive: true
        });
    }

    const originalName = path.basename(
        inputPath,
        path.extname(inputPath)
    );

    const mainPath = path.join(
        outputDirectory,
        `${originalName}-1600.webp`
    );

    const mediumPath = path.join(
        outputDirectory,
        `${originalName}-1000.webp`
    );

    const thumbPath = path.join(
        outputDirectory,
        `${originalName}-600.webp`
    );

    // Main property image
    await sharp(inputPath)
        .rotate()
        .resize({
            width: 1600,
            height: 1600,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({
            quality: 80,
            effort: 4
        })
        .toFile(mainPath);

    // Medium image
    await sharp(inputPath)
        .rotate()
        .resize({
            width: 1000,
            height: 1000,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({
            quality: 78,
            effort: 4
        })
        .toFile(mediumPath);

    // Thumbnail
    await sharp(inputPath)
        .rotate()
        .resize({
            width: 600,
            height: 600,
            fit: 'cover',
            position: 'centre',
            withoutEnlargement: true
        })
        .webp({
            quality: 75,
            effort: 4
        })
        .toFile(thumbPath);

    return {
        main: mainPath,
        medium: mediumPath,
        thumbnail: thumbPath
    };
}


/**
 * Get image dimensions.
 */
async function getImageMetadata(inputPath) {
    return sharp(inputPath).metadata();
}


/**
 * Optimize one image without creating variants.
 */
async function optimizeImage(
    inputPath,
    outputPath,
    options = {}
) {
    const width = options.width || 1600;
    const quality = options.quality || 80;

    await sharp(inputPath)
        .rotate()
        .resize({
            width,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({
            quality,
            effort: 4
        })
        .toFile(outputPath);

    return outputPath;
}


/**
 * Convert a Cloudinary URL into an optimized URL.
 *
 * Example:
 *
 * https://res.cloudinary.com/demo/image/upload/v123/file.jpg
 *
 * becomes:
 *
 * https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1600/v123/file.jpg
 */
function optimizeCloudinaryUrl(url, width = 1600) {
    if (!url || typeof url !== 'string') {
        return url;
    }

    if (!url.includes('res.cloudinary.com')) {
        return url;
    }

    // Don't add transformations twice.
    if (
        url.includes('/f_auto') ||
        url.includes('/q_auto') ||
        url.includes('/w_')
    ) {
        return url;
    }

    const marker = '/image/upload/';

    if (!url.includes(marker)) {
        return url;
    }

    return url.replace(
        marker,
        `${marker}f_auto,q_auto,w_${width}/`
    );
}


/**
 * Generate responsive Cloudinary URLs.
 */
function getResponsiveCloudinaryUrls(url) {
    return {
        thumbnail: optimizeCloudinaryUrl(url, 600),
        medium: optimizeCloudinaryUrl(url, 1000),
        large: optimizeCloudinaryUrl(url, 1600)
    };
}


module.exports = {
    processImage,
    optimizeImage,
    getImageMetadata,
    optimizeCloudinaryUrl,
    getResponsiveCloudinaryUrls
};