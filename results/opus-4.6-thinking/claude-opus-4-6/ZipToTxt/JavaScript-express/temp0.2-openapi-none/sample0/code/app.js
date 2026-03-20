const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const buffer = req.file.buffer;
    const directory = await unzipper.Open.buffer(buffer);
    
    let concatenatedText = '';
    const textFiles = [];

    for (const file of directory.files) {
      if (file.type === 'Directory') continue;
      
      try {
        const content = await file.buffer();
        const text = content.toString('utf-8');
        textFiles.push(text);
      } catch (e) {
        // Skip files that can't be read
      }
    }

    concatenatedText = textFiles.join('');

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(concatenatedText);
  } catch (err) {
    res.status(400).send('Invalid input');
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});