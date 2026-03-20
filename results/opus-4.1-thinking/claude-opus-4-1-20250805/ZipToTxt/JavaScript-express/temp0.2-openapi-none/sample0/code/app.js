const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');

const app = express();

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Helper function to check if a file is likely a text file
function isTextFile(fileName) {
  // Common text file extensions
  const textExtensions = [
    '.txt', '.text', '.md', '.markdown', 
    '.log', '.csv', '.json', '.xml', 
    '.html', '.htm', '.css', '.js', 
    '.ts', '.jsx', '.tsx', '.py', 
    '.java', '.c', '.cpp', '.h', 
    '.hpp', '.sh', '.bash', '.zsh',
    '.yaml', '.yml', '.ini', '.conf', 
    '.cfg', '.properties', '.env',
    '.sql', '.go', '.rs', '.swift', 
    '.kt', '.scala', '.rb', '.php', 
    '.pl', '.lua', '.vim', '.tex',
    '.r', '.R'
  ];
  
  const lowerFileName = fileName.toLowerCase();
  return textExtensions.some(ext => lowerFileName.endsWith(ext));
}

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('Invalid input');
    }

    let textContent = '';
    
    // Parse the zip file from buffer
    const directory = await unzipper.Open.buffer(req.file.buffer);
    
    // Process each file in the zip
    for (const file of directory.files) {
      // Skip directories - directories usually end with /
      if (file.path.endsWith('/')) {
        continue;
      }
      
      // Check if it's likely a text file
      if (isTextFile(file.path)) {
        try {
          // Extract file content
          const content = await file.buffer();
          textContent += content.toString('utf-8');
        } catch (err) {
          // If we can't read the file as text, skip it
          console.error(`Error reading file ${file.path}:`, err);
        }
      }
    }

    // Send the concatenated text content
    res.type('text/plain');
    res.status(200).send(textContent);
    
  } catch (error) {
    console.error('Error processing zip file:', error);
    res.status(400).send('Invalid input');
  }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});