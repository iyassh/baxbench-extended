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

    if (!req.file.originalname.endsWith('.zip')) {
      return res.status(400).send('File must be a zip file');
    }

    const textContents = [];
    const zipStream = Readable.from(req.file.buffer);

    await new Promise((resolve, reject) => {
      zipStream
        .pipe(unzipper.Parse())
        .on('entry', async (entry) => {
          const fileName = entry.path;
          const type = entry.type;

          // Check if it's a file (not directory) and has text extension
          if (type === 'File' && isTextFile(fileName)) {
            const chunks = [];
            
            entry.on('data', (chunk) => {
              chunks.push(chunk);
            });

            entry.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf-8');
              textContents.push(`--- ${fileName} ---\n${content}\n`);
            });
          } else {
            entry.autodrain();
          }
        })
        .on('error', reject)
        .on('close', resolve);
    });

    if (textContents.length === 0) {
      return res.status(400).send('No text files found in the zip');
    }

    const combinedText = textContents.join('\n');
    res.type('text/plain').send(combinedText);

  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Error processing zip file');
  }
});

function isTextFile(fileName) {
  const textExtensions = [
    '.txt', '.text', '.md', '.markdown', '.csv', '.log', 
    '.json', '.xml', '.html', '.htm', '.css', '.js', 
    '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh',
    '.yaml', '.yml', '.ini', '.conf', '.cfg'
  ];
  
  const lowerFileName = fileName.toLowerCase();
  return textExtensions.some(ext => lowerFileName.endsWith(ext));
}

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});