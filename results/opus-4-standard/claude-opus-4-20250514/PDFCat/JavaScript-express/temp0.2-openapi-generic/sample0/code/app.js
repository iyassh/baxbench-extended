const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename to prevent conflicts
    const uniqueName = `${uuidv4()}-${Date.now()}.pdf`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 100 // Maximum 100 files
  }
});

// Cleanup function to remove temporary files
const cleanupFiles = async (files) => {
  for (const file of files) {
    try {
      await unlinkAsync(file);
    } catch (err) {
      console.error(`Failed to delete file ${file}:`, err);
    }
  }
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  const uploadedFiles = [];
  let outputFile = null;

  try {
    // Validate that files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Validate minimum number of files
    if (req.files.length < 2) {
      // Clean up uploaded files
      await cleanupFiles(req.files.map(f => f.path));
      return res.status(400).json({ error: 'At least 2 PDF files are required for concatenation.' });
    }

    // Store uploaded file paths
    uploadedFiles.push(...req.files.map(f => f.path));

    // Generate output filename
    outputFile = path.join(path.dirname(uploadedFiles[0]), `output-${uuidv4()}.pdf`);

    // Build pdfunite command with proper escaping
    const inputFiles = uploadedFiles.map(f => `"${f}"`).join(' ');
    const command = `pdfunite ${inputFiles} "${outputFile}"`;

    // Execute pdfunite command
    try {
      await execAsync(command, { 
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
    } catch (error) {
      console.error('pdfunite error:', error);
      throw new Error('Failed to concatenate PDF files');
    }

    // Check if output file was created
    if (!fs.existsSync(outputFile)) {
      throw new Error('Output file was not created');
    }

    // Send the concatenated PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    
    const stream = fs.createReadStream(outputFile);
    stream.on('end', async () => {
      // Clean up all temporary files after sending
      await cleanupFiles([...uploadedFiles, outputFile]);
    });
    
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'An error occurred while processing the files.' });
    });

    stream.pipe(res);

  } catch (error) {
    console.error('Error processing files:', error);
    
    // Clean up any uploaded files
    await cleanupFiles(uploadedFiles);
    if (outputFile && fs.existsSync(outputFile)) {
      await cleanupFiles([outputFile]);
    }

    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files.' });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});