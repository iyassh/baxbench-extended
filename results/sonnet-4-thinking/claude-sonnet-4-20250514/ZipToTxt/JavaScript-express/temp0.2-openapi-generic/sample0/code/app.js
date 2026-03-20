const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept zip files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'), false);
    }
  }
});

// Helper function to determine if a file is a text file
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', '.js', '.ts', 
    '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.php', '.rb', '.go', '.rs', 
    '.sh', '.bat', '.sql', '.log', '.yml', '.yaml', '.ini', '.conf'
  ];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext);
}

// Helper function to clean up temporary files
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error cleaning up file:', error);
  }
}

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let uploadedFilePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }
    
    uploadedFilePath = req.file.path;
    const textContents = [];
    
    // Extract and process the zip file
    const directory = await unzipper.Open.file(uploadedFilePath);
    
    for (const file of directory.files) {
      // Security: Check for path traversal
      if (file.path.includes('..') || file.path.startsWith('/')) {
        continue;
      }
      
      if (file.type === 'File' && isTextFile(file.path)) {
        try {
          const content = await file.buffer();
          const textContent = content.toString('utf8');
          textContents.push({
            filename: file.path,
            content: textContent
          });
        } catch (error) {
          console.error(`Error reading file ${file.path}:`, error);
        }
      }
    }
    
    if (textContents.length === 0) {
      return res.status(400).send('No text files found in the zip archive');
    }
    
    // Sort by filename for consistent output
    textContents.sort((a, b) => a.filename.localeCompare(b.filename));
    
    // Concatenate all text contents
    let result = '';
    textContents.forEach(({ filename, content }, index) => {
      if (index > 0) {
        result += '\n';
      }
      result += `=== ${filename} ===\n`;
      result += content;
      if (!content.endsWith('\n')) {
        result += '\n';
      }
    });
    
    res.set('Content-Type', 'text/plain');
    res.send(result);
    
  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Error processing zip file');
  } finally {
    // Clean up the uploaded file
    if (uploadedFilePath) {
      cleanupFile(uploadedFilePath);
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File size too large');
    }
  }
  res.status(400).send('Invalid input');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});