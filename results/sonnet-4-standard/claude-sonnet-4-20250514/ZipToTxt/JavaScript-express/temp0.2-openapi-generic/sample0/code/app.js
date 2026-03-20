const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 5000;

// Configure multer for file uploads with security constraints
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only allow zip files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        path.extname(file.originalname).toLowerCase() === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'), false);
    }
  }
});

// Middleware
app.use(express.json({ limit: '10mb' }));

// Helper function to check if a file is a text file
function isTextFile(filename) {
  const textExtensions = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.sql', '.yml', '.yaml', '.ini', '.cfg', '.conf', '.log'];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext);
}

// Helper function to sanitize filename to prevent path traversal
function sanitizeFilename(filename) {
  return path.basename(filename);
}

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const zipBuffer = req.file.buffer;
    let combinedText = '';
    const processedFiles = [];

    // Create a readable stream from the buffer
    const zipStream = unzipper.Parse();
    
    // Process the zip file
    await new Promise((resolve, reject) => {
      const chunks = [];
      
      zipStream.on('entry', (entry) => {
        const fileName = entry.path;
        const type = entry.type;
        
        // Skip directories and non-text files
        if (type === 'Directory' || !isTextFile(fileName)) {
          entry.autodrain();
          return;
        }

        // Sanitize filename to prevent path traversal attacks
        const sanitizedName = sanitizeFilename(fileName);
        
        // Collect file content
        const fileChunks = [];
        entry.on('data', (chunk) => {
          fileChunks.push(chunk);
        });
        
        entry.on('end', () => {
          try {
            const fileContent = Buffer.concat(fileChunks).toString('utf8');
            processedFiles.push({
              name: sanitizedName,
              content: fileContent
            });
          } catch (error) {
            // Skip files that can't be decoded as UTF-8
            console.warn(`Skipping file ${sanitizedName}: ${error.message}`);
          }
        });
      });

      zipStream.on('finish', () => {
        resolve();
      });

      zipStream.on('error', (error) => {
        reject(error);
      });

      // Write the zip buffer to the stream
      zipStream.write(zipBuffer);
      zipStream.end();
    });

    // Sort files by name for consistent output
    processedFiles.sort((a, b) => a.name.localeCompare(b.name));

    // Combine all text files
    for (const file of processedFiles) {
      combinedText += `=== ${file.name} ===\n`;
      combinedText += file.content;
      combinedText += '\n\n';
    }

    if (combinedText.trim() === '') {
      return res.status(400).send('No text files found in the zip archive');
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.txt"');
    
    res.send(combinedText);

  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Error processing zip file: ' + error.message);
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large');
    }
    return res.status(400).send('File upload error: ' + error.message);
  }
  
  if (error.message === 'Only ZIP files are allowed') {
    return res.status(400).send('Only ZIP files are allowed');
  }
  
  res.status(500).send('Internal server error');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`ZipToTxt API server running on http://0.0.0.0:${port}`);
});