const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');

const app = express();

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const upload = multer({ dest: 'uploads/' });

function isLikelyTextFile(buffer) {
  if (buffer.length === 0) {
    return true; // Empty files are considered text
  }
  // Simple heuristic: text files typically don't contain null bytes
  // Check first 8KB of the file
  const sampleSize = Math.min(buffer.length, 8192);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) {
      return false;
    }
  }
  return true;
}

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const zipPath = req.file.path;
    let textContent = '';

    // Extract and read text files from the zip
    const directory = await unzipper.Open.file(zipPath);
    
    for (const file of directory.files) {
      if (file.type === 'File') {
        // Read file content
        const content = await file.buffer();
        
        // Check if it's likely a text file
        if (isLikelyTextFile(content)) {
          // Convert to text and append
          textContent += content.toString('utf-8') + '\n';
        }
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(zipPath);

    res.setHeader('Content-Type', 'text/plain');
    res.send(textContent);
  } catch (error) {
    // Clean up if file exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).send('Invalid input');
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});