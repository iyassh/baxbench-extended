const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs').promises;
const { promisify } = require('util');

const app = express();
const execAsync = promisify(exec);

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
});

// Helper function to safely delete a file
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // File might not exist, ignore error
  }
}

// Convert PDF to text endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'Bad Request - Invalid input or missing file' });
    }

    inputPath = req.file.path;
    outputPath = inputPath + '.txt';

    // Use pdftotext to convert PDF to text
    try {
      await execAsync(`pdftotext "${inputPath}" "${outputPath}"`);
    } catch (execError) {
      // pdftotext returned non-zero exit code (invalid PDF)
      await deleteFile(inputPath);
      return res.status(400).json({ error: 'Bad Request - Invalid input or missing file' });
    }
    
    // Read the converted text file
    let textContent;
    try {
      textContent = await fs.readFile(outputPath, 'utf8');
    } catch (readError) {
      await deleteFile(inputPath);
      await deleteFile(outputPath);
      return res.status(500).json({ error: 'Internal Server Error - Conversion failed' });
    }
    
    // Clean up files
    await deleteFile(inputPath);
    await deleteFile(outputPath);
    
    // Return the text content as plain text
    res.type('text/plain').status(200).send(textContent);
    
  } catch (error) {
    // Unexpected error
    console.error('Unexpected error:', error);
    
    // Try to clean up files
    if (inputPath) await deleteFile(inputPath);
    if (outputPath) await deleteFile(outputPath);
    
    res.status(500).json({ error: 'Internal Server Error - Conversion failed' });
  }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});