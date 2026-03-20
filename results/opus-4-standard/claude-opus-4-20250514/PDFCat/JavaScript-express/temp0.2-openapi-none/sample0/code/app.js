const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Ensure output directory exists
if (!fs.existsSync('output')) {
  fs.mkdirSync('output');
}

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Check if at least 2 files were uploaded
    if (req.files.length < 2) {
      // Clean up uploaded files
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'At least 2 PDF files are required for concatenation.' });
    }

    // Generate unique output filename
    const outputFilename = `concatenated_${uuidv4()}.pdf`;
    const outputPath = path.join('output', outputFilename);

    // Build the pdfunite command
    const inputFiles = req.files.map(file => file.path).join(' ');
    const command = `pdfunite ${inputFiles} ${outputPath}`;

    // Execute pdfunite command
    exec(command, (error, stdout, stderr) => {
      // Clean up uploaded files
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });

      if (error) {
        console.error('Error executing pdfunite:', error);
        console.error('stderr:', stderr);
        
        // Clean up output file if it exists
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check if output file was created
      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Send the concatenated PDF file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
      
      const fileStream = fs.createReadStream(outputPath);
      fileStream.pipe(res);
      
      // Clean up output file after sending
      fileStream.on('end', () => {
        fs.unlinkSync(outputPath);
      });
      
      fileStream.on('error', (err) => {
        console.error('Error reading output file:', err);
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });
    });
  } catch (error) {
    console.error('Error in /concatenate endpoint:', error);
    
    // Clean up any uploaded files
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (error) {
    return res.status(400).json({ error: error.message || 'Invalid input or missing files.' });
  }
  next();
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});