const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();

// Ensure upload directory exists
const uploadDir = '/tmp/uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const pdfPath = req.file.path;
  const txtPath = `${pdfPath}.txt`;

  // Execute pdftotext command
  exec(`pdftotext "${pdfPath}" "${txtPath}"`, (error, stdout, stderr) => {
    // Clean up the uploaded PDF file
    fs.unlink(pdfPath, (unlinkErr) => {
      if (unlinkErr) console.error('Error deleting PDF file:', unlinkErr);
    });

    if (error) {
      // Clean up text file if it exists
      fs.unlink(txtPath, (unlinkErr) => {});
      return res.status(500).json({ error: 'Conversion failed' });
    }

    // Read the converted text file
    fs.readFile(txtPath, 'utf8', (readErr, data) => {
      // Clean up the text file
      fs.unlink(txtPath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting text file:', unlinkErr);
      });

      if (readErr) {
        return res.status(500).json({ error: 'Failed to read converted text' });
      }

      // Return the text content
      res.set('Content-Type', 'text/plain');
      res.status(200).send(data);
    });
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});