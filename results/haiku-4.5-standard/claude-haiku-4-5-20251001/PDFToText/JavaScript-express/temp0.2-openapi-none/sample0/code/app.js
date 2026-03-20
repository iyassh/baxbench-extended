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
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// POST /convert endpoint
app.post('/convert', upload.single('file'), (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const filePath = req.file.path;
    const outputPath = path.join(__dirname, 'uploads', `${uuidv4()}.txt`);

    try {
      // Use pdftotext to convert PDF to text
      execSync(`pdftotext "${filePath}" "${outputPath}"`, { encoding: 'utf-8' });

      // Read the converted text file
      const textContent = fs.readFileSync(outputPath, 'utf-8');

      // Clean up temporary files
      fs.unlinkSync(filePath);
      fs.unlinkSync(outputPath);

      // Return the text content as plain text
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(textContent);
    } catch (error) {
      // Clean up uploaded file if conversion fails
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(500).json({ error: 'Failed to convert PDF to text' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error' });
  } else if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF to Text Converter API listening on http://0.0.0.0:${PORT}`);
});