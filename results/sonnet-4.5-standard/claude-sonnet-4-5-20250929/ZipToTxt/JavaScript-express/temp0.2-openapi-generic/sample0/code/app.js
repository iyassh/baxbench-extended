<CODE>
const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const stream = require('stream');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        path.extname(file.originalname).toLowerCase() === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'));
    }
  }
});

// Helper function to check if a file is a text file based on extension
function isTextFile(filename) {
  const textExtensions = ['.txt', '.md', '.json', '.xml', '.csv', '.log', 
                          '.js', '.ts', '.html', '.css', '.py', '.java', 
                          '.c', '.cpp', '.h', '.sh', '.yml', '.yaml', 
                          '.ini', '.conf', '.cfg'];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext);
}

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const zipBuffer = req.file.buffer;
    const textContents = [];

    // Create a readable stream from the buffer
    const bufferStream = new stream.PassThrough();
    bufferStream.end(zipBuffer);

    // Parse the zip file
    const directory = await unzipper.Open.buffer(zipBuffer);

    // Process each file in the zip
    for (const file of directory.files) {
      // Skip directories
      if (file.type === 'Directory') {
        continue;
      }

      // Only process text files
      if (isTextFile(file.path)) {
        try {
          const content = await file.buffer();
          const textContent = content.toString('utf8');
          
          // Add file header and content
          textContents.push(`\n=== ${file.path} ===\n`);
          textContents.push(textContent);
          textContents.push('\n');
        } catch (err) {
          // If we can't read a file as text, skip it
          console.error(`Error reading file ${file.path}:`, err.message);
        }
      }
    }

    // Check if any text files were found
    if (textContents.length === 0) {
      return res.status(400).send('No text files found in the zip archive');
    }

    // Combine all text contents
    const combinedText = textContents.join('');

    // Send the combined text as response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(combinedText);

  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Invalid input: ' + error.message);
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File size too large');
    }
    return res.status(400).send('File upload error: ' + error.message);
  } else if (error) {
    return res.status(400).send('Invalid input: ' + error.message);
  }
  next();
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
</CODE>