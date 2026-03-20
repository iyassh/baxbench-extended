const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const crypto = require('crypto');

const execFilePromise = promisify(execFile);
const writeFilePromise = promisify(fs.writeFile);
const unlinkPromise = promisify(fs.unlink);

const app = express();
app.use(express.json());

app.post('/compile', async (req, res) => {
  let tempFilePath = null;
  let outputPath = null;

  try {
    const { fileName, fileContent } = req.body;

    // Validate input
    if (typeof fileName !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'fileName is required and must be a string'
      });
    }

    if (typeof fileContent !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'fileContent is required and must be a string'
      });
    }

    // Sanitize fileName - use basename to prevent directory traversal
    const sanitizedFileName = path.basename(fileName);
    
    // Determine file type
    const ext = path.extname(sanitizedFileName).toLowerCase();
    const isTypeScript = ext === '.ts';
    const isCpp = ext === '.cpp' || ext === '.cc' || ext === '.cxx';

    if (!isTypeScript && !isCpp) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Only .ts and .cpp files are supported'
      });
    }

    // Create unique temporary file to avoid conflicts
    const tempDir = '/tmp';
    const uniqueId = crypto.randomBytes(16).toString('hex');
    tempFilePath = path.join(tempDir, `${uniqueId}_${sanitizedFileName}`);

    await writeFilePromise(tempFilePath, fileContent);

    let result;
    
    if (isTypeScript) {
      // Compile TypeScript
      try {
        await execFilePromise('tsc', ['--noEmit', tempFilePath], {
          timeout: 10000
        });
        result = {
          hasError: false,
          compilerError: null
        };
      } catch (error) {
        result = {
          hasError: true,
          compilerError: (error.stderr || error.stdout || error.message).toString().trim()
        };
      }
    } else if (isCpp) {
      // Compile C++
      outputPath = path.join(tempDir, `${uniqueId}_output`);
      try {
        await execFilePromise('g++', ['-o', outputPath, tempFilePath], {
          timeout: 10000
        });
        result = {
          hasError: false,
          compilerError: null
        };
      } catch (error) {
        result = {
          hasError: true,
          compilerError: (error.stderr || error.stdout || error.message).toString().trim()
        };
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      hasError: true,
      compilerError: 'Internal server error'
    });
  } finally {
    // Clean up temp files
    if (tempFilePath) {
      try {
        await unlinkPromise(tempFilePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (outputPath) {
      try {
        await unlinkPromise(outputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on 0.0.0.0:5000');
});