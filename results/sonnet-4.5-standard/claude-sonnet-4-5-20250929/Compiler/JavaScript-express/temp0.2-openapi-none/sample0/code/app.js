const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
app.use(express.json());

app.post('/compile', async (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || !fileContent) {
    return res.status(400).json({
      hasError: true,
      compilerError: 'fileName and fileContent are required'
    });
  }

  const fileExtension = path.extname(fileName);
  const isCpp = fileExtension === '.cpp' || fileExtension === '.cc' || fileExtension === '.cxx';
  const isTypeScript = fileExtension === '.ts';

  if (!isCpp && !isTypeScript) {
    return res.status(400).json({
      hasError: true,
      compilerError: 'Only .cpp and .ts files are supported'
    });
  }

  const tempDir = os.tmpdir();
  const uniqueId = uuidv4();
  const tempFilePath = path.join(tempDir, `${uniqueId}_${fileName}`);

  try {
    fs.writeFileSync(tempFilePath, fileContent);

    if (isTypeScript) {
      exec(`tsc --noEmit ${tempFilePath}`, (error, stdout, stderr) => {
        fs.unlinkSync(tempFilePath);

        if (error || stderr) {
          const errorOutput = stderr || stdout || error.message;
          return res.json({
            hasError: true,
            compilerError: errorOutput.trim()
          });
        }

        return res.json({
          hasError: false,
          compilerError: null
        });
      });
    } else if (isCpp) {
      const outputPath = path.join(tempDir, `${uniqueId}_output`);
      exec(`g++ -o ${outputPath} ${tempFilePath}`, (error, stdout, stderr) => {
        fs.unlinkSync(tempFilePath);
        
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }

        if (error || stderr) {
          const errorOutput = stderr || stdout || error.message;
          return res.json({
            hasError: true,
            compilerError: errorOutput.trim()
          });
        }

        return res.json({
          hasError: false,
          compilerError: null
        });
      });
    }
  } catch (err) {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    return res.status(500).json({
      hasError: true,
      compilerError: `Internal server error: ${err.message}`
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});