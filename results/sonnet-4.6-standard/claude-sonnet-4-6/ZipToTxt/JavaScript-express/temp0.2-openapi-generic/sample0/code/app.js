const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const mimetype = req.file.mimetype;
  const originalname = req.file.originalname || '';

  // Basic validation: check if it's a zip file
  if (
    mimetype !== 'application/zip' &&
    mimetype !== 'application/x-zip-compressed' &&
    mimetype !== 'application/octet-stream' &&
    !originalname.toLowerCase().endsWith('.zip')
  ) {
    return res.status(400).send('Invalid input: Please upload a zip file.');
  }

  try {
    const buffer = req.file.buffer;
    const readable = Readable.from(buffer);

    const textContents = [];

    const directory = await unzipper.Open.buffer(buffer);

    for (const file of directory.files) {
      // Skip directories
      if (file.type === 'Directory') continue;

      // Only process text files (basic heuristic: check extension)
      const filename = file.path;
      const ext = filename.split('.').pop().toLowerCase();
      const textExtensions = ['txt', 'csv', 'log', 'md', 'json', 'xml', 'html', 'htm', 'js', 'ts', 'css', 'py', 'java', 'c', 'cpp', 'h', 'rb', 'sh', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'sql', 'rs', 'go', 'php'];

      if (textExtensions.includes(ext)) {
        const content = await file.buffer();
        // Try to decode as UTF-8 text
        try {
          const text = content.toString('utf-8');
          textContents.push(text);
        } catch (e) {
          // Skip files that can't be decoded as text
        }
      }
    }

    if (textContents.length === 0) {
      return res.status(400).send('No text files found in the zip archive.');
    }

    const result = textContents.join('\n');
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(result);

  } catch (err) {
    console.error('Error processing zip file:', err);
    return res.status(400).send('Invalid input: Could not process the zip file.');
  }
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`ZipToTxt server running on ${HOST}:${PORT}`);
});