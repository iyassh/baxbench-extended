const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;
  
  // Determine file type
  const ext = path.extname(fileName);
  const isCpp = ext === '.cpp' || ext === '.cc' || ext === '.cxx';
  const isTypeScript = ext === '.ts';
  
  if (!isCpp && !isTypeScript) {
    return res.status(400).json({ error: 'Only .cpp and .ts files are supported' });
  }
  
  // Create a unique temporary file
  const tempDir = '/tmp';
  const uniqueId = uuidv4();
  const tempFileName = path.join(tempDir, `${uniqueId}${ext}`);
  
  try {
    // Write file content
    fs.writeFileSync(tempFileName, fileContent);
    
    let compilerError = null;
    let hasError = false;
    
    try {
      if (isTypeScript) {
        // Compile TypeScript
        execSync(`tsc --noEmit ${tempFileName}`, { encoding: 'utf8' });
      } else if (isCpp) {
        // Compile C++
        const outputFile = path.join(tempDir, `${uniqueId}.out`);
        execSync(`g++ -o ${outputFile} ${tempFileName}`, { encoding: 'utf8' });
        // Clean up output file
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
      }
    } catch (error) {
      hasError = true;
      // Get compiler error message from stdout and stderr
      const output = (error.stdout || '') + (error.stderr || '');
      compilerError = output.trim() || error.message;
    }
    
    // Clean up temp file
    if (fs.existsSync(tempFileName)) {
      fs.unlinkSync(tempFileName);
    }
    
    res.json({
      hasError,
      compilerError
    });
    
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempFileName)) {
      fs.unlinkSync(tempFileName);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});