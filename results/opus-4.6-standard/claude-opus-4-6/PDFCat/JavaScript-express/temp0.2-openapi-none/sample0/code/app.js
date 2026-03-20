const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

const upload = multer({ dest: os.tmpdir() });

app.post('/concatenate', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length < 2) {
    // Clean up uploaded files
    if (req.files) {
      req.files.forEach(f => fs.unlink(f.path, () => {}));
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  const outputPath = path.join(os.tmpdir(), `${uuidv4()}.pdf`);
  const inputPaths = req.files.map(f => f.path);
  const args = [...inputPaths, outputPath];

  execFile('pdfunite', args, (error, stdout, stderr) => {
    // Clean up input files
    inputPaths.forEach(p => fs.unlink(p, () => {}));

    if (error) {
      fs.unlink(outputPath, () => {});
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('end', () => {
      fs.unlink(outputPath, () => {});
    });
    readStream.on('error', () => {
      fs.unlink(outputPath, () => {});
      if (!res.headersSent) {
        res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});