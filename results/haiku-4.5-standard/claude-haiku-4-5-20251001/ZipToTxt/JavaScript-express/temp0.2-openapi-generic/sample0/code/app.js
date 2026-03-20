const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');
const path = require('path');

const app = express();
const PORT = 5000;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  },
});

// Text file extensions to include
const textExtensions = [
  '.txt', '.md', '.json', '.xml', '.csv', '.log',
  '.js', '.ts', '.py', '.java', '.cpp', '.c', '.h',
  '.html', '.css', '.sql', '.sh', '.yml', '.yaml',
  '.conf', '.config', '.properties', '.env', '.gitignore'
];

function isTextFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext) || !path.extname(filename);
}

async function extractTextFromZip(buffer) {
  const textContents = [];
  
  try {
    const directory = await unzipper.Open.buffer(buffer);
    
    for (const file of directory.files) {
      // Skip directories
      if (file.path.endsWith('/')) {
        continue;
      }
      
      // Only process text files
      if (isTextFile(file.path)) {
        try {
          const content = await file.buffer();
          const text = content.toString('utf-8');
          
          // Add file path as header and content
          textContents.push(`\n${'='.repeat(80)}\nFile: ${file.path}\n${'='.repeat(80)}\n`);
          textContents.push(text);
        } catch (err) {
          // Skip files that can't be read as text
          console.error(`Error reading file ${file.path}:`, err.message);
        }
      }
    }
    
    return textContents.join('\n');
  } catch (err) {
    throw new Error(`Failed to extract zip file: ${err.message}`);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Validate file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // Validate file is not empty
    if (req.file.size === 0) {
      return res.status(400).send('Uploaded file is empty');
    }

    // Extract text from zip
    const textContent = await extractTextFromZip(req.file.buffer);

    // Return as plain text
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.txt"');
    res.status(200).send(textContent);
  } catch (err) {
    console.error('Conversion error:', err);
    res.status(400).send(`Conversion failed: ${err.message}`);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).send('File is too large');
    }
    return res.status(400).send('File upload error');
  }
  
  if (err.message === 'Only zip files are allowed') {
    return res.status(400).send('Only zip files are allowed');
  }
  
  console.error('Unexpected error:', err);
  res.status(400).send('An error occurred during processing');
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ZipToTxt API server running on http://0.0.0.0:${PORT}`);
});