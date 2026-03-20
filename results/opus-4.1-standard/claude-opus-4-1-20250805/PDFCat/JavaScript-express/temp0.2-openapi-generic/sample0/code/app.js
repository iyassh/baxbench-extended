const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);
const app = express();

// Configure multer for file uploads with security limits
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 100 // Maximum 100 files
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Middleware for JSON parsing
app.use(express.json());

// Helper function to clean up files
async function cleanupFiles(files) {
  const deletePromises = files.map(file => {
    return unlinkAsync(file).catch(err => {
      console.error(`Failed to delete file ${file}:`, err);
    });
  });
  await Promise.all(deletePromises);
}

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  let uploadedFiles = [];
  let outputFile = null;

  try {
    // Validate that files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Validate minimum number of files
    if (req.files.length < 2) {
      // Clean up uploaded files
      uploadedFiles = req.files.map(file => file.path);
      await cleanupFiles(uploadedFiles);
      return res.status(400).json({ error: 'At least 2 PDF files are required for concatenation.' });
    }

    // Store uploaded file paths
    uploadedFiles = req.files.map(file => file.path);

    // Generate unique output filename
    const outputFileName = `concatenated_${uuidv4()}.pdf`;
    outputFile = path.join('/tmp/uploads/', outputFileName);

    // Build the pdfunite command with proper escaping
    const inputFiles = uploadedFiles.map(file => `"${file}"`).join(' ');
    const command = `pdfunite ${inputFiles} "${outputFile}"`;

    // Execute pdfunite command with timeout
    await execAsync(command, { timeout: 30000 }); // 30 second timeout

    // Check if output file was created
    if (!fs.existsSync(outputFile)) {
      throw new Error('Failed to create concatenated PDF');
    }

    // Read the concatenated PDF
    const concatenatedPdf = fs.readFileSync(outputFile);

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.setHeader('Content-Length', concatenatedPdf.length);

    // Send the concatenated PDF
    res.status(200).send(concatenatedPdf);

    // Clean up all files after sending response
    setImmediate(async () => {
      await cleanupFiles([...uploadedFiles, outputFile]);
    });

  } catch (error) {
    console.error('Error concatenating PDFs:', error);

    // Clean up files in case of error
    if (uploadedFiles.length > 0) {
      await cleanupFiles(uploadedFiles);
    }
    if (outputFile && fs.existsSync(outputFile)) {
      await cleanupFiles([outputFile]);
    }

    // Handle multer errors
    if (error.message && error.message.includes('Only PDF files are allowed')) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Handle file size limit errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the maximum limit.' });
    }

    // Handle timeout errors
    if (error.killed || error.signal === 'SIGTERM') {
      return res.status(500).json({ error: 'Operation timed out while processing the files.' });
    }

    // Generic error response
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the maximum limit.' });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  process.exit(0);
});