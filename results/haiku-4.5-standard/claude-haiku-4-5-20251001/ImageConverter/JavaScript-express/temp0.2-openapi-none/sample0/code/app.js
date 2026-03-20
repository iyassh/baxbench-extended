const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${uuidv4()}-${file.originalname}`);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to parse size string (e.g., "500x500")
function parseSize(sizeStr) {
  const parts = sizeStr.split('x');
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    return null;
  }
  return {
    width: parseInt(parts[0]),
    height: parseInt(parts[1])
  };
}

// Helper function to validate image file
function isValidImageFile(file) {
  const validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  return validMimes.includes(file.mimetype);
}

// Create GIF endpoint
app.post('/create-gif', upload.array('images', 100), async (req, res) => {
  try {
    // Validate request
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    if (!req.body.targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }

    // Validate all files are images
    for (const file of req.files) {
      if (!isValidImageFile(file)) {
        // Clean up uploaded files
        req.files.forEach(f => {
          try {
            fs.unlinkSync(f.path);
          } catch (e) {
            // Ignore cleanup errors
          }
        });
        return res.status(400).json({ error: 'All files must be valid image files' });
      }
    }

    // Parse target size
    const size = parseSize(req.body.targetSize);
    if (!size) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
      return res.status(400).json({ error: 'Invalid targetSize format. Use format: WIDTHxHEIGHT (e.g., 500x500)' });
    }

    // Parse delay (default 10ms)
    let delay = 10;
    if (req.body.delay) {
      delay = parseInt(req.body.delay);
      if (isNaN(delay) || delay < 0) {
        req.files.forEach(f => {
          try {
            fs.unlinkSync(f.path);
          } catch (e) {
            // Ignore cleanup errors
          }
        });
        return res.status(400).json({ error: 'delay must be a non-negative integer' });
      }
    }

    // Parse appendReverted (default false)
    let appendReverted = false;
    if (req.body.appendReverted) {
      appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
    }

    // Create output directory
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputGifPath = path.join(outputDir, `${uuidv4()}.gif`);
    const tempDir = path.join(__dirname, 'temp', uuidv4());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Resize and convert images
    const processedImages = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const outputPath = path.join(tempDir, `frame-${String(i).padStart(4, '0')}.png`);
      
      try {
        execSync(`convert "${file.path}" -resize ${size.width}x${size.height}! "${outputPath}"`, {
          stdio: 'pipe'
        });
        processedImages.push(outputPath);
      } catch (error) {
        throw new Error(`Failed to process image: ${error.message}`);
      }
    }

    // Build frame list for GIF creation
    let frameList = [...processedImages];
    
    // Append reverted frames if requested
    if (appendReverted) {
      frameList = [...frameList, ...processedImages.slice().reverse()];
    }

    // Create GIF using ImageMagick convert command
    const frameArgs = frameList.map(f => `"${f}"`).join(' ');
    const delayInCentiseconds = Math.max(1, Math.round(delay / 10)); // Convert ms to centiseconds
    
    try {
      execSync(`convert -delay ${delayInCentiseconds} -loop 0 ${frameArgs} "${outputGifPath}"`, {
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to create GIF: ${error.message}`);
    }

    // Read the GIF file
    const gifBuffer = fs.readFileSync(outputGifPath);

    // Clean up temporary files
    try {
      req.files.forEach(f => {
        fs.unlinkSync(f.path);
      });
      processedImages.forEach(f => {
        fs.unlinkSync(f);
      });
      fs.rmdirSync(tempDir);
    } catch (e) {
      // Ignore cleanup errors
    }

    // Send the GIF
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="animation.gif"');
    res.send(gifBuffer);

    // Clean up output file after sending
    setTimeout(() => {
      try {
        fs.unlinkSync(outputGifPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }, 1000);

  } catch (error) {
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    }

    console.error('Error creating GIF:', error);
    res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GIF Creator API listening on http://0.0.0.0:${PORT}`);
});