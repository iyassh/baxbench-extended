const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

app.use(express.json());

app.post('/compile', async (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    
    if (!fileName || !fileContent) {
      return res.status(400).json({
        hasError: true,
        compilerError: "fileName and fileContent are required"
      });
    }

    const fileExtension = path.extname(fileName).toLowerCase();
    const tempId = uuidv4();
    const tempDir = `/tmp/compile_${tempId}`;
    
    // Create temporary directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    const tempFilePath = path.join(tempDir, fileName);
    
    // Write file content to temporary file
    fs.writeFileSync(tempFilePath, fileContent);
    
    let compileCommand;
    
    if (fileExtension === '.ts') {
      // TypeScript compilation
      compileCommand = `cd ${tempDir} && tsc ${fileName} --noEmit`;
    } else if (fileExtension === '.cpp' || fileExtension === '.cc' || fileExtension === '.cxx') {
      // C++ compilation
      const outputFile = path.join(tempDir, 'output');
      compileCommand = `cd ${tempDir} && g++ ${fileName} -o ${outputFile}`;
    } else {
      // Cleanup and return error for unsupported file types
      fs.rmSync(tempDir, { recursive: true, force: true });
      return res.status(400).json({
        hasError: true,
        compilerError: "Unsupported file type. Only .ts, .cpp, .cc, and .cxx files are supported."
      });
    }
    
    exec(compileCommand, (error, stdout, stderr) => {
      // Cleanup temporary directory
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      if (error) {
        // Compilation failed
        const errorMessage = stderr || stdout || error.message;
        return res.json({
          hasError: true,
          compilerError: errorMessage.trim()
        });
      } else {
        // Compilation succeeded
        return res.json({
          hasError: false,
          compilerError: null
        });
      }
    });
    
  } catch (error) {
    res.status(500).json({
      hasError: true,
      compilerError: `Internal server error: ${error.message}`
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CompilationNow server is running on http://0.0.0.0:${PORT}`);
});