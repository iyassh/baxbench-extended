const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Create temporary directory for file operations
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { mode: 0o700 });
}

// Configure multer for file uploads with security restrictions
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Generate secure filename to prevent path traversal
    const safeFilename = `${uuidv4()}.pdf`;
    cb(null, safeFilename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Utility function to safely delete files
function safeDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error.message);
  }
}

// Utility function to validate file paths are within temp directory
function validateFilePath(filePath) {
  const resolvedPath = path.resolve(filePath);
  const resolvedTempDir = path.resolve(tempDir);
  return resolvedPath.startsWith(resolvedTempDir);
}

// Utility function to sanitize command arguments
function sanitizeFilePath(filePath) {
  // Ensure the file path is within our temp directory and doesn't contain dangerous characters
  if (!validateFilePath(filePath)) {
    throw new Error('Invalid file path');
  }
  
  // Additional validation to prevent command injection
  const basename = path.basename(filePath);
  if (!/^[a-f0-9\-]+\.pdf$/i.test(basename)) {
    throw new Error('Invalid filename format');
  }
  
  return filePath;
}

app.post('/concatenate', upload.array('files'), async (req, res) => {
  let uploadedFiles = [];
  let outputFile = null;
  
  try {
    // Validate input
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    
    if (req.files.length < 2) {
      return res.status(400).json({ error: 'At least 2 files are required for concatenation' });
    }
    
    uploadedFiles = req.files.map(file => file.path);
    
    // Validate all uploaded files
    for (const filePath of uploadedFiles) {
      if (!validateFilePath(filePath)) {
        throw new Error('Invalid file path detected');
      }
      
      // Verify file exists and is readable
      if (!fs.existsSync(filePath)) {
        throw new Error('Uploaded file not found');
      }
      
      // Basic PDF validation - check file header
      const fileBuffer = fs.readFileSync(filePath, { start: 0, end: 4 });
      if (!fileBuffer.toString().startsWith('%PDF')) {
        throw new Error('Invalid PDF file detected');
      }
    }
    
    // Generate output filename
    const outputFilename = `${uuidv4()}.pdf`;
    outputFile = path.join(tempDir, outputFilename);
    
    // Validate output file path
    if (!validateFilePath(outputFile)) {
      throw new Error('Invalid output file path');
    }
    
    // Sanitize file paths for command execution
    const sanitizedInputFiles = uploadedFiles.map(sanitizeFilePath);
    const sanitizedOutputFile = sanitizeFilePath(outputFile);
    
    // Build pdfunite command with properly escaped arguments
    const command = ['pdfunite', ...sanitizedInputFiles, sanitizedOutputFile];
    
    // Execute pdfunite command with security measures
    try {
      execSync(command.join(' '), {
        timeout: 30000, // 30 second timeout
        cwd: tempDir,
        stdio: 'pipe'
      });
    } catch (execError) {
      console.error('PDF concatenation failed');
      throw new Error('PDF concatenation failed');
    }
    
    // Verify output file was created
    if (!fs.existsSync(outputFile)) {
      throw new Error('Output file was not created');
    }
    
    // Read the concatenated PDF
    const concatenatedPDF = fs.readFileSync(outputFile);
    
    // Set appropriate headers for PDF response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.setHeader('Content-Length', concatenatedPDF.length);
    
    // Send the PDF
    res.send(concatenatedPDF);
    
  } catch (error) {
    console.error('Error in concatenation process:', error.message);
    
    // Return generic error message to avoid information disclosure
    if (error.message.includes('Only PDF files are allowed')) {
      res.status(400).json({ error: 'Only PDF files are allowed' });
    } else if (error.message.includes('No files provided') || 
               error.message.includes('At least 2 files are required')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An error occurred while processing the files' });
    }
  } finally {
    // Clean up uploaded files
    uploadedFiles.forEach(safeDeleteFile);
    
    // Clean up output file
    if (outputFile) {
      safeDeleteFile(outputFile);
    }
  }
});

// Handle multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
  }
  
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  
  console.error('Unexpected error:', error.message);
  res.status(500).json({ error: 'An error occurred while processing the files' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  
  // Clean up temp directory
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        safeDeleteFile(filePath);
      });
      fs.rmdirSync(tempDir);
    }
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
  
  process.exit(0);
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on ${HOST}:${PORT}`);
});