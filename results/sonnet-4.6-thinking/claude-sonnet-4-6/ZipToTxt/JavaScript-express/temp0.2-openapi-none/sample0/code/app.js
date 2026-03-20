const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  try {
    const buffer = req.file.buffer;
    const readable = Readable.from(buffer);
    
    const directory = await unzipper.Open.buffer(buffer);
    
    let textContent = '';
    
    for (const file of directory.files) {
      // Skip directories
      if (file.type === 'Directory') continue;
      
      // Check if it's a text file by extension or try to read it as text
      const fileName = file.path;
      const textExtensions = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.js', '.ts', '.css', '.py', '.java', '.c', '.cpp', '.h', '.rb', '.php', '.sh', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log'];
      
      const isTextFile = textExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
      
      if (isTextFile) {
        const content = await file.buffer();
        textContent += content.toString('utf8');
        if (!textContent.endsWith('\n')) {
          textContent += '\n';
        }
      } else {
        // Try to read as text anyway
        try {
          const content = await file.buffer();
          const text = content.toString('utf8');
          // Simple heuristic: if it contains mostly printable characters, treat as text
          const printableRatio = text.split('').filter(c => c.charCodeAt(0) >= 32 || c === '\n' || c === '\r' || c === '\t').length / text.length;
          if (printableRatio > 0.95) {
            textContent += text;
            if (!textContent.endsWith('\n')) {
              textContent += '\n';
            }
          }
        } catch (e) {
          // Skip binary files
        }
      }
    }
    
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(textContent);
  } catch (err) {
    console.error(err);
    res.status(400).send('Invalid zip file or error processing the file.');
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});