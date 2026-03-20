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

      // Only process text files (simple heuristic: check extension)
      const filename = file.path;
      const textExtensions = [
        '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
        '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.css',
        '.yaml', '.yml', '.ini', '.cfg', '.log', '.sh', '.bat',
        '.rb', '.php', '.go', '.rs', '.swift', '.kt', '.scala',
        '.sql', '.r', '.tex', '.rst', '.toml'
      ];

      const lowerFilename = filename.toLowerCase();
      const isTextFile = textExtensions.some(ext => lowerFilename.endsWith(ext));

      if (!isTextFile) continue;

      // Read file content
      const content = await file.buffer();
      
      // Try to decode as UTF-8 text
      try {
        const text = content.toString('utf-8');
        textContents.push(`=== ${filename} ===\n${text}`);
      } catch (e) {
        // Skip files that can't be decoded as text
      }
    }

    if (textContents.length === 0) {
      return res.status(200).type('text/plain').send('');
    }

    const result = textContents.join('\n\n');
    res.status(200).type('text/plain').send(result);

  } catch (err) {
    console.error('Error processing zip file:', err);
    return res.status(400).send('Invalid input: Could not process the zip file.');
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});