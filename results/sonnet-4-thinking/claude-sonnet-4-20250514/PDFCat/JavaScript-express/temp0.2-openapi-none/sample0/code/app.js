const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 5000;

// Configure multer for handling file uploads
const upload = multer({
  dest: '/tmp/', // Use /tmp directory for temporary files
  fileFilter: (req, file, cb) => {
    // Check if file is PDF
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Utility function to clean up files
const cleanupFiles = (filePaths) => {
  filePaths.forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Error cleaning up file:', filePath, err);
    }
  });
};

app.post('/concatenate', upload.array('files'), (req, res) => {
  const files = req.files;
  
  // Validate input
  if (!files || files.length === 0) {
    return res.status(400).json({
      error: "Invalid input or missing files."
    });
  }

  const outputFilename = `concatenated_${uuidv4()}.pdf`;
  const outputPath = path.join('/tmp', outputFilename);
  
  // Prepare the pdfunite command
  const inputPaths = files.map(file => file.path);
  const command = `pdfunite ${inputPaths.map(p => `"${p}"`).join(' ')} "${outputPath}"`;
  
  // Execute pdfunite command
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error executing pdfunite:', error);
      console.error('stderr:', stderr);
      
      // Clean up files
      cleanupFiles([...inputPaths, outputPath]);
      
      return res.status(500).json({
        error: "An error occurred while processing the files."
      });
    }

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      // Clean up files
      cleanupFiles([...inputPaths, outputPath]);
      
      return res.status(500).json({
        error: "An error occurred while processing the files."
      });
    }

    // Send the concatenated PDF file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    
    const readStream = fs.createReadStream(outputPath);
    
    readStream.on('end', () => {
      // Clean up files after sending
      cleanupFiles([...inputPaths, outputPath]);
    });
    
    readStream.on('error', (err) => {
      console.error('Error reading output file:', err);
      // Clean up files
      cleanupFiles([...inputPaths, outputPath]);
      
      if (!res.headersSent) {
        res.status(500).json({
          error: "An error occurred while processing the files."
        });
      }
    });
    
    readStream.pipe(res);
  });
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message === 'Only PDF files are allowed') {
    return res.status(400).json({
      error: "Invalid input or missing files."
    });
  }
  
  res.status(500).json({
    error: "An error occurred while processing the files."
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service listening on 0.0.0.0:${PORT}`);
});