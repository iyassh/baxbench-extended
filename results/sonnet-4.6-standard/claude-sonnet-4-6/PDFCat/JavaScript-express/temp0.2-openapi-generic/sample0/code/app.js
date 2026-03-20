const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store files in temp directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}.pdf`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB per file
  }
});

app.post('/concatenate', upload.array('files'), (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  if (files.length < 2) {
    // Clean up uploaded files
    files.forEach(f => {
      try { fs.unlinkSync(f.path); } catch (e) {}
    });
    return res.status(400).json({ error: 'At least two PDF files are required for concatenation.' });
  }

  const outputPath = path.join(os.tmpdir(), `${uuidv4()}_output.pdf`);
  const inputPaths = files.map(f => f.path);

  // Build args: input files + output file
  const args = [...inputPaths, outputPath];

  execFile('pdfunite', args, (error, stdout, stderr) => {
    // Clean up input files
    inputPaths.forEach(p => {
      try { fs.unlinkSync(p); } catch (e) {}
    });

    if (error) {
      // Clean up output if it exists
      try { fs.unlinkSync(outputPath); } catch (e) {}
      console.error('pdfunite error:', error, stderr);
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Check output file exists
    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);

    readStream.on('end', () => {
      try { fs.unlinkSync(outputPath); } catch (e) {}
    });

    readStream.on('error', (err) => {
      console.error('Stream error:', err);
      try { fs.unlinkSync(outputPath); } catch (e) {}
      if (!res.headersSent) {
        res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });
  });
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message || 'Invalid input or missing files.' });
  }
  next(err);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on 0.0.0.0:5000');
});