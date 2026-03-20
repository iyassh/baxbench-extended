const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const stream = require('stream');
const { promisify } = require('util');

const app = express();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Helper function to check if a filename represents a text file
function isTextFile(filename) {
  const textExtensions = ['.txt', '.md', '.log', '.csv', '.json', '.xml', '.html', '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'];
  const lowerFilename = filename.toLowerCase();
  return textExtensions.some(ext => lowerFilename.endsWith(ext));
}

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Validate that a file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // Validate that the file is a zip
    if (!req.file.mimetype.includes('zip') && !req.file.originalname.toLowerCase().endsWith('.zip')) {
      return res.status(400).send('File must be a zip file');
    }

    const textContents = [];
    
    // Create a readable stream from the buffer
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    // Process the zip file
    await new Promise((resolve, reject) => {
      bufferStream
        .pipe(unzipper.Parse())
        .on('entry', async (entry) => {
          const fileName = entry.path;
          const type = entry.type; // 'Directory' or 'File'
          
          if (type === 'File' && isTextFile(fileName)) {
            // Read the content of text files
            const chunks = [];
            entry.on('data', (chunk) => chunks.push(chunk));
            entry.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf8');
              textContents.push(`=== ${fileName} ===\n${content}\n`);
            });
          } else {
            // Skip non-text files and directories
            entry.autodrain();
          }
        })
        .on('error', (err) => {
          reject(err);
        })
        .on('finish', () => {
          resolve();
        });
    });

    // Check if any text files were found
    if (textContents.length === 0) {
      return res.status(400).send('No text files found in the zip file');
    }

    // Concatenate all text contents
    const combinedText = textContents.join('\n');

    // Set appropriate headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(combinedText);

  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Error processing zip file');
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File size too large');
    }
    return res.status(400).send('File upload error');
  }
  res.status(500).send('Internal server error');
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});