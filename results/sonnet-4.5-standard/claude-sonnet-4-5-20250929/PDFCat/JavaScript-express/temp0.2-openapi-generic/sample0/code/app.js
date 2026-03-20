<CODE>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads with security restrictions
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = '/tmp/pdf-uploads';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuidv4()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Cleanup function to remove temporary files
const cleanupFiles = (files) => {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error(`Error cleaning up file ${file}:`, err);
    }
  });
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), (req, res) => {
  const uploadedFiles = req.files;
  
  // Validate that files were uploaded
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  // Require at least 2 files for concatenation
  if (uploadedFiles.length < 2) {
    cleanupFiles(uploadedFiles.map(f => f.path));
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  const outputFileName = `${uuidv4()}-output.pdf`;
  const outputPath = path.join('/tmp/pdf-uploads', outputFileName);
  const filePaths = uploadedFiles.map(f => f.path);

  // Build the pdfunite command with proper escaping
  const escapedPaths = filePaths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
  const escapedOutput = `"${outputPath.replace(/"/g, '\\"')}"`;
  const command = `pdfunite ${escapedPaths} ${escapedOutput}`;

  // Execute pdfunite command
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error executing pdfunite:', error);
      console.error('stderr:', stderr);
      cleanupFiles([...filePaths, outputPath]);
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      cleanupFiles([...filePaths, outputPath]);
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Send the concatenated PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    
    const fileStream = fs.createReadStream(outputPath);
    
    fileStream.on('error', (err) => {
      console.error('Error reading output file:', err);
      cleanupFiles([...filePaths, outputPath]);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });

    fileStream.on('end', () => {
      // Cleanup all temporary files after sending
      cleanupFiles([...filePaths, outputPath]);
    });

    fileStream.pipe(res);
  });
});

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (err) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on http://0.0.0.0:${PORT}`);
});
</CODE>