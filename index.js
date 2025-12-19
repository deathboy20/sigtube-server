const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { owncloud } = require("./storage/owncloud");
const { processImage, processVideo } = require("./watermark");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", async (req, res) => {
  try {
    const canList = await owncloud.exists("/organizations");
    const canAdmin = await owncloud.exists("/admin");
    res.json({
      status: "ok",
      owncloud: {
        organizationsFolderExists: !!canList,
        adminFolderExists: !!canAdmin,
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      status: "error",
      message: "OwnCloud connectivity failed",
      details: error.message,
    });
  }
});

// List Organizations (folders in /organizations)
app.get("/api/orgs", async (req, res) => {
  try {
    const items = await owncloud.getDirectoryContents("/organizations");
    // Filter only directories
    const orgs = items
      .filter((item) => item.type === "directory")
      .map((item) => ({
        name: item.basename,
        lastModified: item.lastmod,
        size: item.size,
        logo: `/api/orgs/${item.basename}/logo` // Dedicated logo endpoint handles extensions
      }));
    res.json(orgs);
  } catch (error) {
    console.error("List orgs error:", error);
    // If folder doesn't exist, maybe return empty
    if (error.response && error.response.status === 404) {
        return res.json([]);
    }
    res.status(500).json({ error: "Failed to list organizations", details: error.message });
  }
});

// Get Org Logo
app.get("/api/orgs/:orgName/logo", async (req, res) => {
    const { orgName } = req.params;
    // Check for logo with various extensions
    const extensions = ['.png', '.jpg', '.jpeg', '.svg', '.jfif', '.webp', '.gif'];
    
    console.log(`[Logo] Fetching logo for ${orgName}`);

    try {
        for (const ext of extensions) {
            const path = `/organizations/${orgName}/logo${ext}`;
            if (await owncloud.exists(path)) {
                 console.log(`[Logo] Found at ${path}`);
                 const stream = owncloud.createReadStream(path);
                 // Set correct content type based on ext
                 const mimeType = ext === '.svg' ? 'image/svg+xml' : `image/${ext.replace('.', '')}`;
                 res.setHeader('Content-Type', mimeType);
                 stream.pipe(res);
                 return;
            }
        }
        console.log(`[Logo] Not found for ${orgName}`);
        res.status(404).send("Logo not found");
    } catch (error) {
        console.error("Get logo error:", error);
        res.status(500).send("Failed to get logo");
    }
});

// Get Org Details (check existence and size)
app.get("/api/orgs/:orgName", async (req, res) => {
    const { orgName } = req.params;
    try {
        const stat = await owncloud.stat(`/organizations/${orgName}`);
        res.json({ 
            exists: true, 
            name: stat.basename,
            size: stat.size 
        });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ exists: false });
        }
        res.status(500).json({ error: "Error checking org", details: error.message });
    }
});

// Create Organization
app.post("/api/orgs/create", upload.single("logo"), async (req, res) => {
  const { orgName } = req.body;
  const logoFile = req.file;

  if (!orgName) {
    return res.status(400).json({ error: "Organization name is required" });
  }

  try {
    // Create main org folder
    await owncloud.createDirectory(`/organizations/${orgName}`);
    // Create subfolders
    await owncloud.createDirectory(`/organizations/${orgName}/videos`);
    await owncloud.createDirectory(`/organizations/${orgName}/images`);

    // Upload logo if provided
    if (logoFile) {
        const logoPath = `/organizations/${orgName}/logo${path.extname(logoFile.originalname)}`;
        await owncloud.putFileContents(logoPath, logoFile.buffer, { overwrite: true });
    }

    res.json({ success: true, message: `Organization ${orgName} created` });
  } catch (error) {
    console.error("Create org error:", error);
    // 405 means it might already exist
    if (error.response && error.response.status === 405) {
        return res.json({ success: true, message: `Organization ${orgName} already exists` });
    }
    res.status(500).json({ error: "Failed to create organization" });
  }
});

// Admin Logo Upload
app.post("/api/admin/logo", upload.single("logo"), async (req, res) => {
    const logoFile = req.file;
    if (!logoFile) {
        return res.status(400).json({ error: "No logo file provided" });
    }

    try {
        // Ensure admin folder exists
        if (!(await owncloud.exists("/admin"))) {
            await owncloud.createDirectory("/admin");
        }

        // Delete existing logos first
        const extensions = ['.png', '.jpg', '.jpeg', '.svg', '.jfif', '.webp', '.gif'];
        for (const ext of extensions) {
            const oldPath = `/admin/logo${ext}`;
            if (await owncloud.exists(oldPath)) {
                await owncloud.deleteFile(oldPath);
            }
        }

        // Upload new logo
        const logoPath = `/admin/logo${path.extname(logoFile.originalname)}`;
        await owncloud.putFileContents(logoPath, logoFile.buffer, { overwrite: true });

        res.json({ success: true, message: "Admin logo updated" });
    } catch (error) {
        console.error("Admin logo upload error:", error);
        res.status(500).json({ error: "Failed to upload admin logo" });
    }
});

// Get Admin Logo
app.get("/api/admin/logo", async (req, res) => {
    const extensions = ['.png', '.jpg', '.jpeg', '.svg', '.jfif', '.webp', '.gif'];
    
    try {
        if (!(await owncloud.exists("/admin"))) {
             // If admin folder doesn't exist, return 404 immediately
             return res.status(404).send("Admin logo not found");
        }

        for (const ext of extensions) {
            const path = `/admin/logo${ext}`;
            if (await owncloud.exists(path)) {
                 const stream = owncloud.createReadStream(path);
                 const mimeType = ext === '.svg' ? 'image/svg+xml' : `image/${ext.replace('.', '')}`;
                 res.setHeader('Content-Type', mimeType);
                 stream.pipe(res);
                 return;
            }
        }
        res.status(404).send("Admin logo not found");
    } catch (error) {
        console.error("Get admin logo error:", error);
        res.status(500).send("Failed to get admin logo");
    }
});

// Update Organization
app.post("/api/orgs/:orgName/update", upload.single("logo"), async (req, res) => {
    const { orgName } = req.params;
    const { newName } = req.body;
    const logoFile = req.file;

    try {
        let targetOrgName = orgName;

        // Handle renaming if newName is provided and different
        if (newName && newName !== orgName) {
            // Check if new name exists
            if (await owncloud.exists(`/organizations/${newName}`)) {
                return res.status(400).json({ error: "Organization name already taken" });
            }
            // Move directory
            await owncloud.move(`/organizations/${orgName}`, `/organizations/${newName}`);
            targetOrgName = newName;
        }
        
        // Upload logo if provided
        if (logoFile) {
            // Delete existing logos first to avoid confusion (e.g. replacing png with jpg)
            const extensions = ['.png', '.jpg', '.jpeg', '.svg', '.jfif', '.webp', '.gif'];
            for (const ext of extensions) {
                const oldPath = `/organizations/${targetOrgName}/logo${ext}`;
                if (await owncloud.exists(oldPath)) {
                    await owncloud.deleteFile(oldPath);
                }
            }
            
            const logoPath = `/organizations/${targetOrgName}/logo${path.extname(logoFile.originalname)}`;
            await owncloud.putFileContents(logoPath, logoFile.buffer, { overwrite: true });
        }

        res.json({ success: true, message: "Organization updated", newName: targetOrgName });
    } catch (error) {
        console.error("Update org error:", error);
        res.status(500).json({ error: "Failed to update organization" });
    }
});

// Upload File
app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { orgName, folder } = req.body; // videos or images
  const file = req.file;

  if (!file || !orgName || !folder) {
    return res.status(400).json({ error: "Missing file, orgName, or folder" });
  }

  let buffer = file.buffer;
  const mimeType = file.mimetype;

  // Watermark Processing
  try {
      if (mimeType.startsWith('image/')) {
          buffer = await processImage(buffer, orgName);
      } else if (mimeType.startsWith('video/')) {
          // Note: Inline video processing may timeout for large files.
          // Ideally use a job queue.
          buffer = await processVideo(buffer, orgName);
      }
  } catch (err) {
      console.error("Watermark processing failed, uploading original.", err);
  }

  const path = `/organizations/${orgName}/${folder}/${file.originalname}`;

  try {
    await owncloud.putFileContents(path, buffer, { overwrite: true });
    res.json({ success: true, path });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Get/Stream File
app.get("/api/file/:org/:folder/:filename", async (req, res) => {
    const { org, folder, filename } = req.params;
    let path;
    
    // Handle logo special case where folder might be part of filename or omitted in frontend logic, 
    // but here we expect :folder to be part of path. 
    // Wait, the route is /api/file/:org/:folder/:filename
    // If we want logo at root of org, we might need a different route or use a "root" folder param.
    // Let's handle "root" as a magic folder name for org root.
    if (folder === "root") {
         path = `/organizations/${org}/${filename}`;
    } else {
         path = `/organizations/${org}/${folder}/${filename}`;
    }

    try {
        // Try exact match first
        let exists = await owncloud.exists(path);
        
        // If not found and it's a logo request, try other extensions
        if (!exists && filename.startsWith('logo')) {
            const extensions = ['.png', '.jpg', '.jpeg', '.svg'];
            for (const ext of extensions) {
                const tryPath = `/organizations/${org}/${folder === "root" ? "" : folder + "/"}logo${ext}`;
                if (await owncloud.exists(tryPath)) {
                    path = tryPath;
                    exists = true;
                    break;
                }
            }
        }

        if (!exists) {
            return res.status(404).send("File not found");
        }

        // Get file stream
        const stream = owncloud.createReadStream(path);
        stream.pipe(res);
    } catch (error) {
        console.error("Get file error:", error);
        res.status(500).send("Failed to get file");
    }
});

// Stream file by path
app.get("/api/files/stream", async (req, res) => {
    const { path } = req.query;
    if (!path) {
        return res.status(400).send("Missing path");
    }
    
    // console.log(`[Stream] Requesting path: ${path}`);

    try {
        // Get stats first to handle ranges and content-length correctly
        const stat = await owncloud.stat(path);
        
        const fileSize = stat.size;
        const range = req.headers.range;

        // Simple mime type detection
        const ext = path.split('.').pop().toLowerCase();
        const mimeTypes = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'mp4': 'video/mp4',
            'mov': 'video/quicktime',
            'webm': 'video/webm',
            'svg': 'image/svg+xml'
        };
        const mimeType = mimeTypes[ext] || 'application/octet-stream';

        // Handle Range Requests (Critical for video seeking and performance)
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType,
            });

            // Pass Range header to upstream WebDAV server
            const stream = owncloud.createReadStream(path, {
                headers: { 'Range': `bytes=${start}-${end}` }
            });

            stream.on('error', (err) => {
                console.error(`[Stream Error] ${path}:`, err.message);
                if (!res.headersSent) res.end();
            });

            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
            });

            const stream = owncloud.createReadStream(path);
            
            stream.on('error', (err) => {
                console.error(`[Stream Error] ${path}:`, err.message);
                if (!res.headersSent) res.end();
            });

            stream.pipe(res);
        }
    } catch (error) {
        if (error.status === 404 || (error.response && error.response.status === 404)) {
            return res.status(404).send("File not found");
        }
        console.error("Stream file error:", error.message);
        if (!res.headersSent) {
            res.status(500).send("Failed to stream file");
        }
    }
});

// List Files
app.get("/api/list/:org/:folder", async (req, res) => {
  const { org, folder } = req.params;
  const path = `/organizations/${org}/${folder}/`;

  try {
    const items = await owncloud.getDirectoryContents(path);
    res.json(items);
  } catch (error) {
    console.error("List files error:", error);
    res.status(500).json({ error: "Failed to list files" });
  }
});

// Delete File
app.delete("/api/files/delete", async (req, res) => {
    const { path } = req.body;
    if (!path) {
        return res.status(400).json({ error: "Missing path" });
    }
    
    try {
        if (await owncloud.exists(path)) {
            await owncloud.deleteFile(path);
            res.json({ success: true, message: "File deleted" });
        } else {
            res.status(404).json({ error: "File not found" });
        }
    } catch (error) {
        console.error("Delete file error:", error);
        res.status(500).json({ error: "Failed to delete file" });
    }
});

// Move/Rename File
app.post("/api/files/move", async (req, res) => {
    const { source, destination } = req.body;
    if (!source || !destination) {
        return res.status(400).json({ error: "Missing source or destination" });
    }

    try {
        if (await owncloud.exists(source)) {
            await owncloud.move(source, destination);
            res.json({ success: true, message: "File moved" });
        } else {
            res.status(404).json({ error: "Source file not found" });
        }
    } catch (error) {
        console.error("Move file error:", error);
        res.status(500).json({ error: "Failed to move file" });
    }
});

const PORT = process.env.PORT || 3000;

// Initialize WebDAV structure
const initWebDav = async () => {
  try {
    const exists = await owncloud.exists("/organizations");
    if (!exists) {
      console.log("Creating /organizations folder...");
      await owncloud.createDirectory("/organizations");
    }
  } catch (error) {
    console.error("Failed to initialize WebDAV:", error);
  }
};

if (require.main === module) {
  app.listen(PORT, async () => {
    await initWebDav();
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
