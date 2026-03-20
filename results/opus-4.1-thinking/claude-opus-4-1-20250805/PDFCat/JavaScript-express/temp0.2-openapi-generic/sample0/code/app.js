const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Generate secure unique filename
    const uniqueName = `${uuidv4()}.pdf`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files based on mimetype and extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' && (file.mimetype === 'application/pdf' || file.mimetype === 'application/x-pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Helper function to check if file is a valid PDF by checking magic bytes
const isPDF = (filepath) => {
  try {
    const buffer = Buffer.alloc(5);
    const fd = fs.openSync(filepath, 'r');
    fs.readSync(fd, buffer, 0, 5, 0);
    fs.closeSync(fd);
    return buffer.toString('ascii') === '%PDF-';
  } catch (err) {
    return false;
  }
};

// Cleanup function for temporary files
const cleanupFiles = (files) => {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error(`Error deleting file ${file}:`, err);
    }
  });
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  let tempFiles = [];
  let outputFile = null;

  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Check if at least 1 PDF was uploaded
    if (req.files.length < 1) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Store file paths and validate each is a PDF
    tempFiles = req.files.map(file => file.path);
    
    // Validate all files are actual PDFs
    for (const filepath of tempFiles) {
      if (!isPDF(filepath)) {
        cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
    }

    // Generate output filename
    outputFile = path.join(tempDir, `output_${uuidv4()}.pdf`);

    // Use spawn instead of exec to avoid shell injection
    const pdfuniteProcess = spawn('pdfunite', [...tempFiles, outputFile]);

    // Wait for the process to complete
    await new Promise((resolve, reject) => {
      let stderr = '';
      
      pdfuniteProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pdfuniteProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`pdfunite failed with code ${code}: ${stderr}`));
        } else {
          resolve();
        }
      });

      pdfuniteProcess.on('error', (err) => {
        reject(err);
      });
    });

    // Check if output file was created
    if (!fs.existsSync(outputFile)) {
      throw new Error('Failed to create concatenated PDF');
    }

    // Read the output file
    const pdfBuffer = fs.readFileSync(outputFile);

    // Clean up all temporary files including output
    cleanupFiles([...tempFiles, outputFile]);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);

    // Send the PDF
    res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error('Error concatenating PDFs:', error);

    // Clean up temporary files in case of error
    if (tempFiles.length > 0) {
      cleanupFiles(tempFiles);
    }
    if (outputFile && fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }

    // Determine appropriate error response
    if (error.message && (error.message.includes('Only PDF files are allowed') || error.message.includes('pdfunite failed'))) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  // Clean up any uploaded files in case of error
  if (req.files) {
    const filesToClean = Array.isArray(req.files) ? req.files.map(f => f.path) : 
                         req.files.path ? [req.files.path] : 
                         Object.values(req.files).flat().map(f => f.path);
    cleanupFiles(filesToClean);
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  if (error.message && error.message.includes('Only PDF files are allowed')) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Clean up temp directory on exit
process.on('SIGINT', () => {
  console.log('Cleaning up temp directory...');
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    files.forEach(file => {
      const filepath = path.join(tempDir, file);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });
  }
  process.exit(0);
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});