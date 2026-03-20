const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const { Readable } = require('stream');

const app = express();

// Configure multer for memory storage with size limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only zip files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.mimetype === 'multipart/x-zip' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  }
});

// Helper function to check if a file is a text file
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.text', '.md', '.markdown', '.csv', '.log', 
    '.json', '.xml', '.html', '.htm', '.css', '.js', 
    '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', 
    '.h', '.hpp', '.cs', '.rb', '.go', '.rs', '.php',
    '.sql', '.sh', '.bash', '.yaml', '.yml', '.toml',
    '.ini', '.conf', '.config', '.env', '.properties'
  ];
  
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext) || filename.toLowerCase().includes('readme');
}

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // Create a readable stream from the buffer
    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null);

    let concatenatedText = '';
    const processedFiles = [];

    // Parse the zip file
    const zipStream = bufferStream.pipe(unzipper.Parse({ forceStream: true }));

    for await (const entry of zipStream) {
      const fileName = entry.path;
      const type = entry.type; // 'Directory' or 'File'
      
      if (type === 'File' && isTextFile(fileName)) {
        try {
          // Read the content of the text file
          const content = await entry.buffer();
          const textContent = content.toString('utf8');
          
          // Add file separator and content
          if (concatenatedText.length > 0) {
            concatenatedText += '\n\n';
          }
          concatenatedText += `=== ${fileName} ===\n`;
          concatenatedText += textContent;
          
          processedFiles.push(fileName);
        } catch (err) {
          console.error(`Error processing file ${fileName}:`, err);
          // Continue processing other files
        }
      } else {
        // Auto-drain non-text files to continue processing
        entry.autodrain();
      }
    }

    // Check if any text files were found
    if (processedFiles.length === 0) {
      return res.status(400).send('No text files found in the zip archive');
    }

    // Send the concatenated text
    res.type('text/plain');
    res.status(200).send(concatenatedText);

  } catch (error) {
    console.error('Error processing zip file:', error);
    
    // Send appropriate error response
    if (error.message && error.message.includes('zip')) {
      res.status(400).send('Invalid zip file');
    } else {
      res.status(400).send('Error processing file');
    }
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
  
  if (error) {
    return res.status(400).send('Invalid input');
  }
  
  next();
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});