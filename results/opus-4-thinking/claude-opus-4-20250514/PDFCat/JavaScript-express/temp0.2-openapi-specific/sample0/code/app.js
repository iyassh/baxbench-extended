const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const uuid = require('uuid');

const app = express();

// Ensure upload directory exists
const uploadDir = '/tmp/pdf-uploads';
(async () => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create upload directory:', err);
    process.exit(1);
  }
})();

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 100 // Maximum 100 files
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Security middleware - add security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Helper function to clean up files
async function cleanupFiles(files) {
  await Promise.all(files.map(async (file) => {
    try {
      await fs.unlink(file);
    } catch (err) {
      // Ignore errors during cleanup
    }
  }));
}

// Helper function to validate PDF file
async function isPdfFile(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(4);
    await handle.read(buffer, 0, 4, 0);
    await handle.close();
    // Check PDF magic number %PDF
    return buffer.toString() === '%PDF';
  } catch (err) {
    return false;
  }
}

// Helper function to run pdfunite safely
function runPdfUnite(inputFiles, outputFile) {
  return new Promise((resolve, reject) => {
    const args = [...inputFiles, outputFile];
    const proc = spawn('pdfunite', args, {
      cwd: uploadDir,
      timeout: 30000,
      env: {}, // Empty environment for security
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stderr = '';
    let stdout = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data;
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data;
    });
    
    proc.on('error', (err) => {
      reject(new Error('Failed to execute pdfunite'));
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Failed to concatenate PDF files'));
      }
    });
    
    // Kill process if it takes too long
    setTimeout(() => {
      proc.kill();
    }, 30000);
  });
}

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  const uploadedFiles = [];
  const outputFileName = `${uuid.v4()}.pdf`;
  const outputFile = path.join(uploadDir, outputFileName);
  
  try {
    // Validate request
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    if (req.files.length < 2) {
      // Clean up uploaded files
      await cleanupFiles(req.files.map(f => f.path));
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    // Validate all files are PDFs and collect file paths
    for (const file of req.files) {
      // Ensure file path is within the upload directory
      const normalizedPath = path.resolve(file.path);
      if (!normalizedPath.startsWith(path.resolve(uploadDir))) {
        await cleanupFiles(uploadedFiles);
        await cleanupFiles(req.files.map(f => f.path));
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
      
      uploadedFiles.push(normalizedPath);
      const isValid = await isPdfFile(normalizedPath);
      if (!isValid) {
        await cleanupFiles(uploadedFiles);
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
    }
    
    // Run pdfunite using spawn to prevent command injection
    const fileNames = uploadedFiles.map(f => path.basename(f));
    
    await runPdfUnite(fileNames, outputFileName);
    
    // Check if output file was created and is valid
    let concatenatedPdf;
    try {
      const stats = await fs.stat(outputFile);
      if (stats.size === 0) {
        throw new Error('Output file is empty');
      }
      concatenatedPdf = await fs.readFile(outputFile);
    } catch (err) {
      throw new Error('Failed to read concatenated PDF');
    }
    
    // Clean up all temporary files
    uploadedFiles.push(outputFile);
    await cleanupFiles(uploadedFiles);
    
    // Send the concatenated PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="concatenated.pdf"',
      'Content-Length': concatenatedPdf.length
    });
    res.send(concatenatedPdf);
    
  } catch (error) {
    // Clean up files on error
    if (uploadedFiles.length > 0 || outputFile) {
      uploadedFiles.push(outputFile);
      await cleanupFiles(uploadedFiles);
    }
    
    // Don't expose internal error details
    console.error('Error concatenating PDFs:', error.message);
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  // Clean up any uploaded files on error
  if (req.files && Array.isArray(req.files)) {
    cleanupFiles(req.files.map(f => f.path)).catch(() => {});
  }
  
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  if (error.message && error.message.includes('Only PDF files')) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  // Generic error - don't expose details
  console.error('Unhandled error:', error.message);
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server closed');
  });
});