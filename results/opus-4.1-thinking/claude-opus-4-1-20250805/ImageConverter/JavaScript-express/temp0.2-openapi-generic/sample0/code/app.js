const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer for handling file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 100 // Maximum 100 files
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/tiff'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// Middleware
app.use(express.json());

// Helper function to validate targetSize format
function validateTargetSize(targetSize) {
  const pattern = /^\d+x\d+$/;
  if (!pattern.test(targetSize)) {
    return false;
  }
  const [width, height] = targetSize.split('x').map(Number);
  // Reasonable limits
  if (width < 1 || width > 5000 || height < 1 || height > 5000) {
    return false;
  }
  return true;
}

// Helper function to clean up files
async function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error(`Error deleting file ${file}:`, err);
    }
  }
}

// Helper function to run ImageMagick convert command safely
function runConvert(inputFiles, outputFile, targetSize, delayInCentiseconds) {
  return new Promise((resolve, reject) => {
    const args = [];
    
    // Add delay first (applies to all subsequent images)
    args.push('-delay', delayInCentiseconds.toString());
    
    // Add input files
    inputFiles.forEach(file => {
      args.push(file);
    });
    
    // Add resize option
    args.push('-resize', targetSize);
    
    // Add loop
    args.push('-loop', '0');
    
    // Add output file
    args.push(outputFile);
    
    const convertProcess = spawn('convert', args);
    
    let stderr = '';
    let killed = false;
    
    convertProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    convertProcess.on('close', (code) => {
      if (!killed) {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Convert process exited with code ${code}: ${stderr}`));
        }
      }
    });
    
    convertProcess.on('error', (err) => {
      if (!killed) {
        reject(err);
      }
    });
    
    // Add timeout
    setTimeout(() => {
      if (!killed) {
        killed = true;
        convertProcess.kill();
        reject(new Error('Convert process timeout'));
      }
    }, 30000);
  });
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images'), async (req, res) => {
  const uploadedFiles = req.files || [];
  const filesToCleanup = [];
  
  try {
    // Validate required parameters
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    const targetSize = req.body.targetSize;
    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }
    
    if (!validateTargetSize(targetSize)) {
      return res.status(400).json({ error: 'Invalid targetSize format. Use format like "500x500"' });
    }
    
    // Parse optional parameters
    let delay = parseInt(req.body.delay);
    if (isNaN(delay) || delay < 0) {
      delay = 10; // Default value
    }
    if (delay > 10000) {
      delay = 10000; // Cap at 10 seconds
    }
    
    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
    
    // Add uploaded files to cleanup list
    uploadedFiles.forEach(file => filesToCleanup.push(file.path));
    
    // Generate unique output filename
    const outputFilename = path.join('/tmp', `gif_${uuidv4()}.gif`);
    filesToCleanup.push(outputFilename);
    
    // Build the list of input files
    let inputFiles = uploadedFiles.map(file => file.path);
    
    // If appendReverted is true, add the files in reverse order
    if (appendReverted && inputFiles.length > 1) {
      // Skip the first element of reversed to avoid duplication at transition
      const reversedFiles = [...inputFiles].reverse().slice(1);
      inputFiles = [...inputFiles, ...reversedFiles];
    }
    
    // Convert delay from milliseconds to centiseconds (1/100 of a second)
    // Minimum 1 centisecond to avoid issues
    const delayInCentiseconds = Math.max(1, Math.round(delay / 10));
    
    // Execute the convert command safely using spawn
    try {
      await runConvert(inputFiles, outputFilename, targetSize, delayInCentiseconds);
    } catch (error) {
      console.error('ImageMagick error:', error);
      await cleanupFiles(filesToCleanup);
      return res.status(500).json({ error: 'Failed to create GIF' });
    }
    
    // Check if output file was created
    if (!fs.existsSync(outputFilename)) {
      await cleanupFiles(filesToCleanup);
      return res.status(500).json({ error: 'GIF creation failed' });
    }
    
    // Read the generated GIF
    const gifData = fs.readFileSync(outputFilename);
    
    // Clean up files
    await cleanupFiles(filesToCleanup);
    
    // Send the GIF as response
    res.set('Content-Type', 'image/gif');
    res.send(gifData);
    
  } catch (error) {
    console.error('Error processing request:', error);
    
    // Clean up any uploaded files in case of error
    await cleanupFiles(filesToCleanup);
    
    if (error.message && error.message.includes('Invalid file type')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware for multer and other errors
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Clean up any uploaded files if multer error
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
  }
  
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});