const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(fs.unlink);
const readFileAsync = promisify(fs.readFile);
const accessAsync = promisify(fs.access);

// Ensure upload directory exists
const uploadDir = '/tmp/uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 100 // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    // Basic validation - check if filename ends with .pdf
    if (path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Cleanup function for temporary files
async function cleanupFiles(files) {
  const deletePromises = files.map(async (file) => {
    try {
      await accessAsync(file, fs.constants.F_OK);
      await unlinkAsync(file);
    } catch (err) {
      // File doesn't exist or error deleting, ignore
      if (err.code !== 'ENOENT') {
        console.error(`Failed to delete ${file}:`, err);
      }
    }
  });
  await Promise.all(deletePromises);
}

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  const uploadedFiles = [];
  let outputFile = null;

  try {
    // Validate that files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Validate minimum 2 files for concatenation
    if (req.files.length < 2) {
      // Clean up uploaded files
      await cleanupFiles(req.files.map(f => f.path));
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Track uploaded files for cleanup
    uploadedFiles.push(...req.files.map(f => f.path));

    // Generate unique output filename
    outputFile = path.join(uploadDir, `concatenated_${uuidv4()}.pdf`);

    // Prepare arguments for pdfunite
    const args = [...req.files.map(f => f.path), outputFile];

    // Execute pdfunite using execFile for better security
    try {
      await execFileAsync('pdfunite', args);
    } catch (error) {
      console.error('pdfunite error:', error);
      await cleanupFiles([...uploadedFiles, outputFile]);
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Read the concatenated PDF
    const pdfData = await readFileAsync(outputFile);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');

    // Send the PDF
    res.send(pdfData);

    // Clean up all temporary files
    await cleanupFiles([...uploadedFiles, outputFile]);

  } catch (error) {
    console.error('Error in /concatenate:', error);
    
    // Clean up any files that were created
    const filesToClean = [...uploadedFiles];
    if (outputFile) {
      filesToClean.push(outputFile);
    }
    await cleanupFiles(filesToClean);

    // Return appropriate error response
    if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (error) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});