const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');

const app = express();

// Configure multer for memory storage with size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Basic check for zip file
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'));
    }
  }
});

// Helper function to determine if a file is a text file
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.text', '.log', '.md', '.csv', '.json', '.xml', 
    '.html', '.htm', '.js', '.css', '.py', '.java', '.c', 
    '.cpp', '.h', '.hpp', '.sh', '.yml', '.yaml', '.ini',
    '.cfg', '.conf', '.properties', '.sql', '.rb', '.php',
    '.pl', '.r', '.ts', '.jsx', '.tsx', '.vue', '.swift'
  ];
  return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // Parse the zip file from buffer
    const directory = await unzipper.Open.buffer(req.file.buffer);
    
    const textContents = [];
    
    // Process each file in the zip
    for (const file of directory.files) {
      // Skip directories and non-text files
      if (file.type !== 'File' || !isTextFile(file.path)) {
        continue;
      }
      
      try {
        // Get the file content as buffer and convert to string
        const content = await file.buffer();
        const textContent = content.toString('utf-8');
        textContents.push({
          fileName: file.path,
          content: textContent
        });
      } catch (err) {
        // Skip files that can't be read as text
        console.error(`Error reading file ${file.path}:`, err.message);
      }
    }
    
    // Sort files by name for consistent output
    textContents.sort((a, b) => a.fileName.localeCompare(b.fileName));
    
    // Combine all text contents
    let combinedText = '';
    for (let i = 0; i < textContents.length; i++) {
      if (i > 0) {
        combinedText += '\n';
      }
      combinedText += `--- ${textContents[i].fileName} ---\n${textContents[i].content}`;
    }
    
    // Send the combined text
    res.type('text/plain').send(combinedText);

  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Invalid input or error processing file');
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large');
    }
    return res.status(400).send('Invalid input');
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