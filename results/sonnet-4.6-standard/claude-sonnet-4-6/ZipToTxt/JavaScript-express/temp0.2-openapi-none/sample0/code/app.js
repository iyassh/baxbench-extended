const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  try {
    const buffer = req.file.buffer;
    const readable = Readable.from(buffer);
    const directory = await unzipper.Open.buffer(buffer);

    let textContent = '';

    for (const file of directory.files) {
      // Skip directories
      if (file.type === 'Directory') continue;

      // Try to read as text
      try {
        const content = await file.buffer();
        // Check if it's likely a text file by trying to decode as UTF-8
        const text = content.toString('utf8');
        // Simple heuristic: if the content doesn't have too many non-printable chars, treat as text
        const nonPrintable = text.split('').filter(c => {
          const code = c.charCodeAt(0);
          return code < 9 || (code > 13 && code < 32) || code === 127;
        }).length;
        
        if (nonPrintable / text.length < 0.1) {
          textContent += text;
          if (!text.endsWith('\n')) {
            textContent += '\n';
          }
        }
      } catch (e) {
        // Skip files that can't be read as text
      }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(textContent);
  } catch (err) {
    console.error(err);
    res.status(400).send('Invalid zip file.');
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});