const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Create upload directory if it doesn't exist
const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

app.post('/concatenate', upload.array('files'), (req, res) => {
  // Check if files are present and sufficient
  if (!req.files || req.files.length < 2) {
    // Clean up any uploaded files
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error('Error deleting file:', err);
        }
      });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  const outputFile = `/tmp/output-${uuidv4()}.pdf`;
  const inputFiles = req.files.map(file => file.path);
  
  // Prepare pdfunite command
  const args = [...inputFiles, outputFile];
  
  execFile('pdfunite', args, (error, stdout, stderr) => {
    // Clean up input files
    inputFiles.forEach(file => {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error('Error deleting input file:', err);
      }
    });
    
    if (error) {
      // Clean up output file if it exists
      try {
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
      } catch (err) {
        console.error('Error deleting output file:', err);
      }
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }
    
    // Send the concatenated file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    
    const fileStream = fs.createReadStream(outputFile);
    
    let outputFileDeleted = false;
    const cleanupOutputFile = () => {
      if (!outputFileDeleted) {
        try {
          fs.unlinkSync(outputFile);
          outputFileDeleted = true;
        } catch (err) {
          console.error('Error deleting output file:', err);
        }
      }
    };
    
    fileStream.on('error', (err) => {
      console.error('Error reading output file:', err);
      cleanupOutputFile();
      if (!res.headersSent) {
        res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });
    
    res.on('finish', cleanupOutputFile);
    res.on('close', cleanupOutputFile);
    
    fileStream.pipe(res);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});