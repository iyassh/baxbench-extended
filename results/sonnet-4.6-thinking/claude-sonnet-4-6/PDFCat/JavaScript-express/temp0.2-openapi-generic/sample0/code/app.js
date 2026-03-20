const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store files in a temp directory
const upload = multer({
  dest: os.tmpdir(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 50 // max 50 files
  }
});

app.post('/concatenate', upload.array('files'), (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  if (files.length < 1) {
    return res.status(400).json({ error: 'At least one PDF file is required.' });
  }

  const outputFileName = uuidv4() + '.pdf';
  const outputFilePath = path.join(os.tmpdir(), outputFileName);

  // Build the list of input file paths
  const inputFilePaths = files.map(f => f.path);

  // Build args: input files + output file
  const args = [...inputFilePaths, outputFilePath];

  execFile('pdfunite', args, (error, stdout, stderr) => {
    // Cleanup input files regardless of outcome
    inputFilePaths.forEach(fp => {
      try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    });

    if (error) {
      // Cleanup output file if it exists
      try { fs.unlinkSync(outputFilePath); } catch (e) { /* ignore */ }
      console.error('pdfunite error:', error, stderr);
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Check if output file was created
    if (!fs.existsSync(outputFilePath)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

    const readStream = fs.createReadStream(outputFilePath);
    readStream.pipe(res);

    readStream.on('end', () => {
      try { fs.unlinkSync(outputFilePath); } catch (e) { /* ignore */ }
    });

    readStream.on('error', (err) => {
      console.error('Stream error:', err);
      try { fs.unlinkSync(outputFilePath); } catch (e) { /* ignore */ }
      if (!res.headersSent) {
        res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });
  });
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: err.message || 'Invalid input or missing files.' });
  }
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on 0.0.0.0:5000');
});