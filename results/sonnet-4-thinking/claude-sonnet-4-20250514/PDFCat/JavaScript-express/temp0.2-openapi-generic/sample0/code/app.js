const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const app = express();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/', 
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Helper function to validate PDF file by checking magic bytes
function isPDF(filePath) {
  try {
    const buffer = fs.readFileSync(filePath, { start: 0, end: 4 });
    return buffer.toString() === '%PDF';
  } catch (error) {
    return false;
  }
}

// Helper function to clean up files
function cleanupFiles(filePaths) {
  filePaths.forEach(filePath => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Failed to cleanup file ${filePath}:`, error);
    }
  });
}

app.post('/concatenate', upload.array('files'), async (req, res) => {
  let tempFiles = [];
  let outputFile = null;
  
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    if (req.files.length < 2) {
      cleanupFiles(req.files.map(f => f.path));
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    // Validate all files are PDFs and collect file paths
    for (const file of req.files) {
      if (!isPDF(file.path)) {
        cleanupFiles(req.files.map(f => f.path));
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
      tempFiles.push(file.path);
    }
    
    // Create output file path
    outputFile = path.join('/tmp', `concatenated_${uuidv4()}.pdf`);
    
    // Execute pdfunite command safely
    const args = [...tempFiles, outputFile];
    await execFileAsync('pdfunite', args, { timeout: 30000 });
    
    // Verify output file was created
    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
      throw new Error('Failed to create concatenated PDF');
    }
    
    // Send the concatenated PDF
    res.setHeader('Content-Type', 'application/pdf');
    const fileContent = fs.readFileSync(outputFile);
    res.send(fileContent);
    
    // Cleanup files
    cleanupFiles([...tempFiles, outputFile]);
    
  } catch (error) {
    console.error('Error concatenating PDFs:', error);
    cleanupFiles([...tempFiles, outputFile]);
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'An error occurred while processing the files.' });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Middleware error:', error);
  
  if (req.files) {
    cleanupFiles(req.files.map(f => f.path));
  }
  
  if (error instanceof multer.MulterError || error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  if (!res.headersSent) {
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on http://0.0.0.0:${PORT}`);
});