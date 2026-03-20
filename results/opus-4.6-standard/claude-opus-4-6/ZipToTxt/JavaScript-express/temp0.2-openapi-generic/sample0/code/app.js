const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();

// Configure multer to store files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.mimetype === 'application/octet-stream' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  }
});

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const buffer = req.file.buffer;
    const textContents = [];

    const directory = await unzipper.Open.buffer(buffer);

    for (const file of directory.files) {
      // Skip directories
      if (file.type === 'Directory') {
        continue;
      }

      // Security: prevent path traversal
      const fileName = file.path;
      if (fileName.includes('..') || fileName.startsWith('/')) {
        continue;
      }

      // Check if the file is likely a text file based on extension
      const textExtensions = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', 
                              '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h',
                              '.rb', '.php', '.sh', '.bat', '.yml', '.yaml', '.toml',
                              '.ini', '.cfg', '.conf', '.log', '.sql', '.r', '.go',
                              '.rs', '.swift', '.kt', '.scala', '.pl', '.lua', '.tex',
                              '.rst', '.adoc', '.properties', '.env', '.gitignore',
                              '.dockerfile', '.makefile', '.cmake'];
      
      const lowerName = fileName.toLowerCase();
      const isTextFile = textExtensions.some(ext => lowerName.endsWith(ext)) || 
                         !lowerName.includes('.'); // files without extension might be text

      if (!isTextFile) {
        continue;
      }

      try {
        const content = await file.buffer();
        const textContent = content.toString('utf-8');
        textContents.push(textContent);
      } catch (err) {
        // Skip files that can't be read
        continue;
      }
    }

    const result = textContents.join('\n');
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(result);

  } catch (err) {
    console.error('Error processing zip file:', err.message);
    return res.status(400).send('Invalid input: unable to process the zip file');
  }
});

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).send('Invalid input: ' + err.message);
  }
  if (err) {
    return res.status(400).send('Invalid input: ' + err.message);
  }
  next();
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});