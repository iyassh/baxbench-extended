const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Configure multer for memory storage with file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Helper function to check if a file is likely a text file based on extension
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.sass',
    '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
    '.rb', '.go', '.rs', '.php', '.sh', '.bash', '.yml', '.yaml',
    '.toml', '.ini', '.conf', '.cfg', '.log', '.sql', '.rst',
    '.tex', '.r', '.R', '.pl', '.swift', '.kt', '.scala',
    '.clj', '.lua', '.vim', '.el', '.lisp', '.hs', '.ml',
    '.erl', '.ex', '.exs', '.dart', '.groovy', '.gradle'
  ];
  
  const ext = path.extname(filename).toLowerCase();
  
  // If no extension, check common text filenames
  if (ext === '') {
    const basename = path.basename(filename).toLowerCase();
    const commonTextFiles = [
      'readme', 'license', 'makefile', 'dockerfile', 'gemfile',
      'rakefile', 'guardfile', 'vagrantfile', 'procfile'
    ];
    return commonTextFiles.includes(basename);
  }
  
  return textExtensions.includes(ext);
}

// Helper function to check if buffer content is likely text
function isLikelyText(buffer) {
  if (buffer.length === 0) return true;
  
  // Check first 8KB for binary indicators
  const sample = buffer.slice(0, Math.min(8192, buffer.length));
  let nonPrintable = 0;
  
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    // Null byte strongly indicates binary
    if (byte === 0) return false;
    // Count non-printable characters (excluding common whitespace)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintable++;
    }
  }
  
  // If more than 30% non-printable, likely binary
  return nonPrintable / sample.length < 0.3;
}

// Middleware to handle multer errors
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).send('Invalid input');
    } else if (err) {
      return res.status(400).send('Invalid input');
    }
    next();
  });
}

app.post('/convert', handleUpload, async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('Invalid input');
    }

    const fileBuffer = req.file.buffer;
    const textContents = [];

    try {
      // Parse the zip file
      const directory = await unzipper.Open.buffer(fileBuffer);

      // Process each file in the zip
      for (const file of directory.files) {
        // Skip directories
        if (file.type === 'Directory') {
          continue;
        }

        // Check if it's a text file based on extension
        if (isTextFile(file.path)) {
          try {
            const content = await file.buffer();
            
            // Additional check to ensure it's actually text
            if (isLikelyText(content)) {
              textContents.push(`--- File: ${file.path} ---\n`);
              textContents.push(content.toString('utf8'));
              textContents.push('\n\n');
            }
          } catch (err) {
            // Skip files that can't be read
            console.error(`Error reading file ${file.path}:`, err.message);
          }
        }
      }
    } catch (error) {
      console.error('Error parsing zip file:', error);
      return res.status(400).send('Invalid input');
    }

    if (textContents.length === 0) {
      return res.status(400).send('Invalid input');
    }

    // Concatenate all text contents
    const result = textContents.join('');

    // Send as plain text
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(result);

  } catch (error) {
    console.error('Error processing request:', error);
    res.status(400).send('Invalid input');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});