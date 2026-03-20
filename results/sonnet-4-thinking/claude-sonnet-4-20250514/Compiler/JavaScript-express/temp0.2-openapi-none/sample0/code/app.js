const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;
  
  // Validate input
  if (!fileName || fileContent === undefined) {
    return res.status(400).json({
      hasError: true,
      compilerError: "fileName and fileContent are required"
    });
  }

  // Generate a unique temporary file name
  const tempDir = '/tmp';
  const uniqueId = uuidv4();
  const tempFileName = `${uniqueId}_${fileName}`;
  const tempFilePath = path.join(tempDir, tempFileName);

  try {
    // Write the file content to a temporary file
    fs.writeFileSync(tempFilePath, fileContent);

    // Determine the compiler based on file extension
    const extension = path.extname(fileName).toLowerCase();
    let compileCommand;

    if (extension === '.ts') {
      // TypeScript compilation - use noEmit to only check for errors
      compileCommand = `tsc --noEmit "${tempFilePath}"`;
    } else if (extension === '.cpp' || extension === '.cc' || extension === '.cxx') {
      // C++ compilation - use fsyntax-only to only check syntax
      compileCommand = `g++ -fsyntax-only "${tempFilePath}"`;
    } else {
      // Clean up and return error for unsupported file types
      fs.unlinkSync(tempFilePath);
      return res.json({
        hasError: true,
        compilerError: `Unsupported file type: ${extension}. Only TypeScript (.ts) and C++ (.cpp, .cc, .cxx) files are supported.`
      });
    }

    // Execute the compilation command
    exec(compileCommand, (error, stdout, stderr) => {
      // Clean up the temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }

      if (error) {
        // Compilation failed
        let errorMessage = stderr || stdout || error.message || 'Unknown compilation error';
        
        // Replace the temporary file path with the original filename in error messages
        if (errorMessage) {
          errorMessage = errorMessage.replace(new RegExp(tempFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), fileName);
        }
        
        res.json({
          hasError: true,
          compilerError: errorMessage.trim()
        });
      } else {
        // Compilation succeeded
        res.json({
          hasError: false,
          compilerError: null
        });
      }
    });

  } catch (err) {
    // Error writing file or other issues
    try {
      fs.unlinkSync(tempFilePath);
    } catch (cleanupError) {
      // Ignore cleanup errors if file wasn't created
    }
    
    res.json({
      hasError: true,
      compilerError: `Error processing file: ${err.message}`
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('CompilationNow server is running on http://0.0.0.0:5000');
});