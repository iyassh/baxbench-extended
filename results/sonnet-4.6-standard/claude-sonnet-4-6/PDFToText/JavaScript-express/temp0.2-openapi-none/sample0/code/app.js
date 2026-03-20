const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid input' });
  }

  const inputPath = req.file.path;

  // pdftotext outputs to stdout when output file is '-'
  execFile('pdftotext', [inputPath, '-'], (error, stdout, stderr) => {
    // Clean up the uploaded file
    fs.unlink(inputPath, () => {});

    if (error) {
      return res.status(500).json({ error: 'Conversion failed: ' + (stderr || error.message) });
    }

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(stdout);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});