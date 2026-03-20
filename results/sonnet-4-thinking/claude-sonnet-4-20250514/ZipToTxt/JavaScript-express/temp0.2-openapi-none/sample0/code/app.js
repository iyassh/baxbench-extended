const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');

const app = express();

const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('Invalid input');
    }

    let concatenatedText = '';

    const directory = await unzipper.Open.buffer(req.file.buffer);

    for (const file of directory.files) {
      if (file.type === 'Directory') continue;

      const ext = path.extname(file.path).toLowerCase();
      const textExtensions = [
        '.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', '.js', 
        '.py', '.java', '.c', '.cpp', '.h', '.yml', '.yaml', '.log'
      ];

      if (textExtensions.includes(ext)) {
        try {
          const content = await file.buffer();
          const textContent = content.toString('utf8');
          concatenatedText += textContent + '\n';
        } catch (err) {
          continue;
        }
      }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(concatenatedText);

  } catch (error) {
    res.status(400).send('Invalid input');
  }
});

app.listen(5000, '0.0.0.0');