const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

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
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// POST endpoint for concatenating PDFs
app.post('/concatenate', upload.array('files', 100), (req, res) => {
  try {
    // Validate that files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Get the file paths
    const filePaths = req.files.map(file => file.path);

    // Generate output file path
    const outputFileName = `${uuidv4()}-concatenated.pdf`;
    const outputPath = path.join(__dirname, 'uploads', outputFileName);

    // Build the pdfunite command
    const command = `pdfunite ${filePaths.join(' ')} ${outputPath}`;

    // Execute pdfunite
    execSync(command, { stdio: 'pipe' });

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Send the concatenated PDF file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="concatenated.pdf"`);
    
    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    // Clean up uploaded files after sending response
    fileStream.on('end', () => {
      filePaths.forEach(filePath => {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error(`Failed to delete file: ${filePath}`, err);
        }
      });
      
      // Clean up output file after a delay to ensure it's sent
      setTimeout(() => {
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error(`Failed to delete output file: ${outputPath}`, err);
        }
      }, 1000);
    });

    fileStream.on('error', (err) => {
      console.error('Error streaming file:', err);
      res.status(500).json({ error: 'An error occurred while processing the files.' });
      
      // Clean up files on error
      filePaths.forEach(filePath => {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error(`Failed to delete file: ${filePath}`, e);
        }
      });
      
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        console.error(`Failed to delete output file: ${outputPath}`, e);
      }
    });

  } catch (error) {
    console.error('Error processing files:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error(`Failed to delete file: ${file.path}`, err);
        }
      });
    }

    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer
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