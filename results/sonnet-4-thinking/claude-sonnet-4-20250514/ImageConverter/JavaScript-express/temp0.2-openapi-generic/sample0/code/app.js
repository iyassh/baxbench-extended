const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 50 // Max 50 files
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

app.post('/create-gif', upload.array('images'), async (req, res) => {
  let tempFiles = [];
  
  try {
    const { targetSize, delay = '10', appendReverted = 'false' } = req.body;
    const images = req.files;

    // Validate inputs
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }

    // Validate targetSize format (e.g., "500x500")
    const sizeRegex = /^(\d+)x(\d+)$/;
    const sizeMatch = targetSize.match(sizeRegex);
    if (!sizeMatch) {
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
    }

    // Validate size values are reasonable
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    if (width > 4000 || height > 4000 || width < 1 || height < 1) {
      return res.status(400).json({ error: 'Invalid target size. Width and height must be between 1 and 4000 pixels' });
    }

    // Validate delay
    const delayMs = parseInt(delay);
    if (isNaN(delayMs) || delayMs < 0 || delayMs > 10000) {
      return res.status(400).json({ error: 'Invalid delay value. Must be between 0 and 10000 milliseconds' });
    }

    // Convert milliseconds to centiseconds for ImageMagick (minimum 1cs = 10ms)
    const delayCs = Math.max(1, Math.round(delayMs / 10));

    // Parse appendReverted
    const shouldAppendReverted = appendReverted === 'true' || appendReverted === true;

    // Track temp files for cleanup
    tempFiles = images.map(img => img.path);

    // Verify all input files exist
    for (const image of images) {
      if (!fs.existsSync(image.path)) {
        throw new Error('Uploaded file not found');
      }
    }

    // Create unique output filename
    const outputPath = path.join('/tmp', `gif-${uuidv4()}.gif`);
    tempFiles.push(outputPath);

    // Build ImageMagick convert command
    const convertArgs = [];
    
    // Add input files
    images.forEach(image => {
      convertArgs.push(image.path);
    });

    // Add reversed files if requested
    if (shouldAppendReverted) {
      for (let i = images.length - 1; i >= 0; i--) {
        convertArgs.push(images[i].path);
      }
    }

    // Add conversion options
    convertArgs.push('-resize', targetSize);
    convertArgs.push('-delay', delayCs.toString());
    convertArgs.push('-loop', '0'); // Infinite loop
    convertArgs.push(outputPath);

    // Execute ImageMagick convert command
    await new Promise((resolve, reject) => {
      const convert = spawn('convert', convertArgs);
      
      // Set a timeout
      const timeout = setTimeout(() => {
        convert.kill();
        reject(new Error('ImageMagick convert command timed out'));
      }, 30000); // 30 seconds
      
      let errorOutput = '';
      convert.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      convert.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ImageMagick convert failed (code ${code}): ${errorOutput}`));
        }
      });

      convert.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to execute convert command: ${error.message}`));
      });
    });

    // Check if output file was created and has content
    if (!fs.existsSync(outputPath)) {
      throw new Error('Failed to create GIF file');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      throw new Error('Generated GIF file is empty');
    }

    // Send the GIF file
    res.setHeader('Content-Type', 'image/gif');
    
    const gifData = fs.readFileSync(outputPath);
    res.send(gifData);

    // Clean up files
    cleanupFiles(tempFiles);

  } catch (error) {
    console.error('Error creating GIF:', error);
    cleanupFiles(tempFiles);
    
    return res.status(500).json({ error: 'Internal server error while creating GIF' });
  }
});

function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (error) {
      console.error(`Failed to delete file ${file}:`, error);
    }
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
  }
  
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({ error: error.message });
  }
  
  return res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GIF Creator API server running on http://0.0.0.0:${PORT}`);
});