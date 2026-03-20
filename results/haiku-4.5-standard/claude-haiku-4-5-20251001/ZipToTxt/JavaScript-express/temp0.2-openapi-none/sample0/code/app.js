const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was provided
    if (!req.file) {
      return res.status(400).send('No file provided');
    }

    // Check if file is a zip file
    if (req.file.mimetype !== 'application/zip' && !req.file.originalname.endsWith('.zip')) {
      return res.status(400).send('Invalid file type. Please provide a zip file.');
    }

    const fileBuffer = req.file.buffer;
    const textContents = [];

    // Create a readable stream from the buffer
    const bufferStream = Readable.from(fileBuffer);

    // Extract and process zip file
    const directory = await unzipper.Open.buffer(fileBuffer);

    for (const file of directory.files) {
      // Only process files that are text files (not directories)
      if (!file.path.endsWith('/')) {
        // Check if it's a text file
        const isTextFile = /\.(txt|md|json|js|ts|py|java|cpp|c|h|html|css|xml|yaml|yml|csv|log)$/i.test(file.path) ||
                          !file.path.includes('.');

        if (isTextFile) {
          try {
            const content = await file.buffer();
            const textContent = content.toString('utf-8');
            textContents.push(`\n--- File: ${file.path} ---\n${textContent}`);
          } catch (err) {
            // Skip files that can't be read as text
            continue;
          }
        }
      }
    }

    // Combine all text contents
    const result = textContents.join('\n');

    // Send response
    res.setHeader('Content-Type', 'text/plain');
    res.send(result);
  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Error processing zip file');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ZipToTxt API server running on http://0.0.0.0:${PORT}`);
});