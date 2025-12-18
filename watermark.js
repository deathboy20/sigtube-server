const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { owncloud } = require('./storage/owncloud');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const SIGTRACK_LOGO_PATH = path.join(__dirname, 'assets', 'sigtrack-logo.svg');

// Helper to get Org Logo Buffer
async function getOrgLogoBuffer(orgName) {
    const extensions = ['.png', '.jpg', '.jpeg', '.svg', '.jfif', '.webp', '.gif'];
    for (const ext of extensions) {
        const logoPath = `/organizations/${orgName}/logo${ext}`;
        if (await owncloud.exists(logoPath)) {
            const content = await owncloud.getFileContents(logoPath, { format: "binary" });
            return content;
        }
    }
    return null;
}

// Helper to Create Rounded Logo with Transparency
async function createRoundedLogo(inputBuffer, size = 70, opacity = 0.8) {
    try {
        const rounded = Buffer.from(
            `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${size / 2}" ry="${size / 2}"/></svg>`
        );

        return await sharp(inputBuffer)
            .resize(size, size, { fit: 'cover' })
            .composite([{
                input: rounded,
                blend: 'dest-in'
            }])
            .ensureAlpha(opacity) // Set transparency (0.0 - 1.0)
            .png()
            .toBuffer();
    } catch (error) {
        console.error("Error creating rounded logo:", error);
        return inputBuffer;
    }
}

// Process Image
async function processImage(fileBuffer, orgName) {
    try {
        console.log(`[Watermark] Processing image for ${orgName}`);
        
        // Settings
        const LOGO_SIZE = 50;
        const PADDING = 20;
        const OPACITY = 0.8;

        // Load Sigtrack Logo (Top Right)
        const sigtrackLogo = await createRoundedLogo(SIGTRACK_LOGO_PATH, LOGO_SIZE, OPACITY);
        
        // Load Org Logo (Top Left)
        const orgLogoBuffer = await getOrgLogoBuffer(orgName);
        let orgLogo = null;
        if (orgLogoBuffer) {
            orgLogo = await createRoundedLogo(orgLogoBuffer, LOGO_SIZE, OPACITY);
        }

        let composite = [
            // SigTrack Logo: Top Right
            { input: sigtrackLogo, gravity: 'northeast', top: PADDING, left: PADDING }
        ];

        if (orgLogo) {
            // Org Logo: Top Left
            composite.push({ input: orgLogo, gravity: 'northwest', top: PADDING, left: PADDING });
        }

        // Apply watermarks
        const outputBuffer = await sharp(fileBuffer)
            .composite(composite)
            .toBuffer();
            
        console.log(`[Watermark] Image processed successfully`);
        return outputBuffer;
    } catch (error) {
        console.error("[Watermark] Image processing error:", error);
        return fileBuffer; // Return original if failed
    }
}

// Process Video
async function processVideo(fileBuffer, orgName) {
    console.log(`[Watermark] Processing video for ${orgName}`);
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input-${Date.now()}.mp4`);
    const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);
    const sigtrackLogoPath = path.join(tempDir, `sigtrack-${Date.now()}.png`);
    const orgLogoPath = path.join(tempDir, `org-${Date.now()}.png`);

    try {
        fs.writeFileSync(inputPath, fileBuffer);
        
        // Settings
        const LOGO_SIZE = 50;
        const PADDING = 20;
        const OPACITY = 0.8;

        // Prepare Logos
        const sigtrackLogo = await createRoundedLogo(SIGTRACK_LOGO_PATH, LOGO_SIZE, OPACITY);
        await sharp(sigtrackLogo).toFile(sigtrackLogoPath);
        
        const orgLogoBuffer = await getOrgLogoBuffer(orgName);
        let hasOrgLogo = false;
        if (orgLogoBuffer) {
             const orgLogo = await createRoundedLogo(orgLogoBuffer, LOGO_SIZE, OPACITY);
             await sharp(orgLogo).toFile(orgLogoPath);
             hasOrgLogo = true;
        }

        return new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath);
            
            // Inputs
            // Input 0: Video
            // Input 1: SigTrack Logo
            command.input(sigtrackLogoPath);
            
            // Input 2: Org Logo (if exists)
            if (hasOrgLogo) command.input(orgLogoPath);

            // Filter Complex
            // [0:v] is video. [1:v] is sigtrack. [2:v] is org.
            
            // SigTrack: Top Right (main_w - overlay_w - PADDING, PADDING)
            // Org: Top Left (PADDING, PADDING)
            
            let filter = "";
            
            // Apply SigTrack (Input 1) to Top Right
            filter += `[0:v][1:v]overlay=main_w-overlay_w-${PADDING}:${PADDING}`;
            
            if (hasOrgLogo) {
                // If Org Logo exists, chain the output of first overlay [tmp]
                filter += `[tmp];[tmp][2:v]overlay=${PADDING}:${PADDING}`;
            }
            
            command.complexFilter(filter)
                .outputOptions('-c:a copy') // Copy audio
                .on('end', () => {
                    console.log(`[Watermark] Video processed successfully`);
                    const outputBuffer = fs.readFileSync(outputPath);
                    // Cleanup
                    cleanup([inputPath, outputPath, sigtrackLogoPath, orgLogoPath]);
                    resolve(outputBuffer);
                })
                .on('error', (err) => {
                    console.error("[Watermark] FFmpeg error:", err);
                    cleanup([inputPath, outputPath, sigtrackLogoPath, orgLogoPath]);
                    // Return original on error
                    resolve(fileBuffer);
                })
                .save(outputPath);
        });

    } catch (error) {
        console.error("[Watermark] Video processing setup error:", error);
        cleanup([inputPath, outputPath, sigtrackLogoPath, orgLogoPath]);
        return fileBuffer;
    }
}

function cleanup(paths) {
    paths.forEach(p => {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch(e) {}
    });
}

module.exports = { processImage, processVideo };
