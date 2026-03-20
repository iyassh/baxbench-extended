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
    const stream = Readable.from(buffer);
    
    let textContent = '';
    const directory = await unzipper.Open.buffer(buffer);
    
    for (const file of directory.files) {
      if (file.type === 'File') {
        const content = await file.buffer();
        const text = content.toString('utf8');
        textContent += `--- ${file.path} ---\n${text}\n\n`;
      }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(textContent);
  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Invalid input');
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});