const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { owncloud } = require("./storage/owncloud");
const { processImage, processVideo } = require("./watermark");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const os = require("os");

dotenv.config();

const app = express();

// Use disk storage for better large file handling on memory-constrained servers (like Render)
// Files are stored in the system's temp directory
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, os.tmpdir());
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // Limit to 500MB (adjust as needed for Render plan)
    }
});

// CORS Configuration - Allow requests from all origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : [
      'http://localhost:5173',
      'https://staging-sigtrack-admin-dashboard.vercel.app',
      'https://sigtrack-admin-dashboard-a4q6.vercel.app',
      'http://localhost:5000'
    ];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.log(`[CORS] Allowing request from: ${origin}`);
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Get Org Config (JSON file with credentials and metadata)
app.get("/api/orgs/:orgName/config", async (req, res) => {
    const { orgName } = req.params;
    try {
        const configPath = `/organizations/${orgName}/config.json`;
        const configContent = await owncloud.getFileContents(configPath);
        const configData = JSON.parse(configContent.toString());
        
        console.log(`[OrgConfig] Retrieved config for ${orgName}`);
        res.json(configData);
    } catch (error) {
        console.error(`[OrgConfig] Error retrieving config for ${orgName}:`, error);
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ error: "Organization config not found" });
        }
        res.status(500).json({ error: "Failed to retrieve organization config", details: error.message });
    }
});

// Helper function to safely create directories (checks if they exist first)
const createOrgDirectories = async (orgName) => {
  const directories = [
    `/organizations/${orgName}`,
    `/organizations/${orgName}/videos`,
    `/organizations/${orgName}/images`
  ];

  for (const dir of directories) {
    try {
      const exists = await owncloud.exists(dir);
      if (!exists) {
        await owncloud.createDirectory(dir);
        console.log(`[OrgCreate] Created directory: ${dir}`);
      } else {
        console.log(`[OrgCreate] Directory already exists: ${dir}`);
      }
    } catch (error) {
      // If 405, the directory already exists - this is okay
      if (error.response && error.response.status === 405) {
        console.log(`[OrgCreate] Directory already exists (405): ${dir}`);
      } else {
        throw error;
      }
    }
  }
};

// Create Organization - Primary endpoint /api/orgs/create
app.post("/api/orgs/create", upload.single("logo"), async (req, res) => {
  const { orgName, password, createdAt } = req.body;
  const logoFile = req.file;

  if (!orgName) {
    return res.status(400).json({ error: "Organization name is required" });
  }

  if (!password) {
    return res.status(400).json({ error: "Organization password is required" });
  }

  try {
    // Create directories (safely handles existing ones)
    await createOrgDirectories(orgName);

    // Create config.json with organization metadata
    const configData = {
      orgId: orgName,
      password: password,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1.0"
    };

    const configPath = `/organizations/${orgName}/config.json`;
    await owncloud.putFileContents(configPath, JSON.stringify(configData, null, 2), { overwrite: true });
    console.log(`[OrgCreate] Created config.json for ${orgName}`);

    // Upload logo if provided
    if (logoFile) {
        const logoPath = `/organizations/${orgName}/logo${path.extname(logoFile.originalname)}`;
        const buffer = fs.readFileSync(logoFile.path);
        await owncloud.putFileContents(logoPath, buffer, { overwrite: true });
        // Clean up temp file
        fs.unlinkSync(logoFile.path);
        console.log(`[OrgCreate] Uploaded logo for ${orgName}`);
    }

    res.json({ success: true, message: `Organization ${orgName} created successfully` });
  } catch (error) {
    console.error("Create org error:", error);
    // Cleanup temp file if error
    if (logoFile && fs.existsSync(logoFile.path)) {
      try {
        fs.unlinkSync(logoFile.path);
      } catch (e) {
        console.error("Failed to cleanup temp file:", e.message);
      }
    }
    res.status(500).json({ error: "Failed to create organization", details: error.message });
  }
});

// Alias route without /api prefix for frontend compatibility
app.post("/orgs/create", upload.single("logo"), async (req, res) => {
  const { orgName, password, createdAt } = req.body;
  const logoFile = req.file;

  if (!orgName) {
    return res.status(400).json({ error: "Organization name is required" });
  }

  if (!password) {
    return res.status(400).json({ error: "Organization password is required" });
  }

  try {
    // Create directories (safely handles existing ones)
    await createOrgDirectories(orgName);

    // Create config.json with organization metadata
    const configData = {
      orgId: orgName,
      password: password,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1.0"
    };

    const configPath = `/organizations/${orgName}/config.json`;
    await owncloud.putFileContents(configPath, JSON.stringify(configData, null, 2), { overwrite: true });
    console.log(`[OrgCreate] Created config.json for ${orgName}`);

    // Upload logo if provided
    if (logoFile) {
        const logoPath = `/organizations/${orgName}/logo${path.extname(logoFile.originalname)}`;
        const buffer = fs.readFileSync(logoFile.path);
        await owncloud.putFileContents(logoPath, buffer, { overwrite: true });
        // Clean up temp file
        fs.unlinkSync(logoFile.path);
        console.log(`[OrgCreate] Uploaded logo for ${orgName}`);
    }

    res.json({ success: true, message: `Organization ${orgName} created successfully` });
  } catch (error) {
    console.error("Create org error:", error);
    // Cleanup temp file if error
    if (logoFile && fs.existsSync(logoFile.path)) {
      try {
        fs.unlinkSync(logoFile.path);
      } catch (e) {
        console.error("Failed to cleanup temp file:", e.message);
      }
    }
    res.status(500).json({ error: "Failed to create organization", details: error.message });
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
        const buffer = fs.readFileSync(logoFile.path);
        await owncloud.putFileContents(logoPath, buffer, { overwrite: true });
        
        // Clean up temp file
        fs.unlinkSync(logoFile.path);

        res.json({ success: true, message: "Admin logo updated" });
    } catch (error) {
        console.error("Admin logo upload error:", error);
        if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path);
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
            const buffer = fs.readFileSync(logoFile.path);
            await owncloud.putFileContents(logoPath, buffer, { overwrite: true });
            fs.unlinkSync(logoFile.path);
        }

        res.json({ success: true, message: "Organization updated", newName: targetOrgName });
    } catch (error) {
        console.error("Update org error:", error);
        if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path);
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

  const mimeType = file.mimetype;
  let uploadPath = file.path;
  let isTempFile = true; // Track if we need to delete uploadPath later

  // Watermark Processing
  try {
      if (mimeType.startsWith('image/')) {
          // Images are small, read to buffer
          let buffer = fs.readFileSync(file.path);
          buffer = await processImage(buffer, orgName);
          // Overwrite the temp file with processed buffer
          fs.writeFileSync(file.path, buffer);
          uploadPath = file.path;
      } else if (mimeType.startsWith('video/')) {
          // Videos use path-based processing
          // processVideo now takes path and returns output path
          const processedPath = await processVideo(file.path, orgName);
          
          // If processed path is different (success), we use it.
          // If it failed, it returns original path.
          if (processedPath !== file.path) {
              // Delete original temp file as we have a new output file
              fs.unlinkSync(file.path);
              uploadPath = processedPath;
          }
      }
  } catch (err) {
      console.error("Watermark processing failed, uploading original.", err);
  }

  const remotePath = `/organizations/${orgName}/${folder}/${file.originalname}`;

  try {
    // Use stream for upload to handle large files efficiently
    const readStream = fs.createReadStream(uploadPath);
    const writeStream = owncloud.createWriteStream(remotePath);
    
    // Pipe data
    readStream.pipe(writeStream);

    // Wait for finish
    await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        readStream.on('error', reject);
    });

    res.json({ success: true, path: remotePath });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  } finally {
      // Clean up temp file(s)
      if (fs.existsSync(uploadPath)) {
          fs.unlinkSync(uploadPath);
      }
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
