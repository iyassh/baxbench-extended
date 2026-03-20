const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Validate file extension
function isValidExtension(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.ts' || ext === '.cpp';
}

// Sanitize filename to prevent path traversal
function sanitizeFileName(fileName) {
  // Remove any path components, only keep the base name
  const baseName = path.basename(fileName);
  // Only allow alphanumeric, dots, hyphens, and underscores
  if (!/^[a-zA-Z0-9._-]+$/.test(baseName)) {
    return null;
  }
  return baseName;
}

app.post('/compile', async (req, res) => {
  let tempDir = null;
  
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid request body' 
      });
    }

    const { fileName, fileContent } = req.body;

    // Validate inputs
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid or missing fileName' 
      });
    }

    if (typeof fileContent !== 'string') {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid or missing fileContent' 
      });
    }

    // Sanitize and validate filename
    const sanitizedFileName = sanitizeFileName(fileName);
    if (!sanitizedFileName) {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid filename format' 
      });
    }

    if (!isValidExtension(sanitizedFileName)) {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Only .ts and .cpp files are supported' 
      });
    }

    // Create a unique temporary directory
    const randomId = crypto.randomBytes(16).toString('hex');
    tempDir = path.join('/tmp', `compile_${randomId}`);
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

    const filePath = path.join(tempDir, sanitizedFileName);
    
    // Write file content
    fs.writeFileSync(filePath, fileContent, { mode: 0o600 });

    const ext = path.extname(sanitizedFileName).toLowerCase();
    let compileResult;

    if (ext === '.ts') {
      // Compile TypeScript
      compileResult = await new Promise((resolve) => {
        execFile('tsc', ['--noEmit', sanitizedFileName], {
          cwd: tempDir,
          timeout: 10000,
          maxBuffer: 1024 * 1024
        }, (error, stdout, stderr) => {
          const output = stdout + stderr;
          if (error || output.trim()) {
            resolve({ hasError: true, compilerError: output.trim() || 'Compilation failed' });
          } else {
            resolve({ hasError: false, compilerError: null });
          }
        });
      });
    } else if (ext === '.cpp') {
      // Compile C++
      const outputBinary = path.join(tempDir, 'output');
      compileResult = await new Promise((resolve) => {
        execFile('g++', ['-fsyntax-only', sanitizedFileName], {
          cwd: tempDir,
          timeout: 10000,
          maxBuffer: 1024 * 1024
        }, (error, stdout, stderr) => {
          const output = stderr + stdout;
          if (error || output.trim()) {
            resolve({ hasError: true, compilerError: output.trim() || 'Compilation failed' });
          } else {
            resolve({ hasError: false, compilerError: null });
          }
        });
      });
    }

    res.status(200).json(compileResult);

  } catch (error) {
    // Generic error message to avoid leaking sensitive information
    res.status(500).json({ 
      hasError: true, 
      compilerError: 'An error occurred during compilation' 
    });
  } finally {
    // Cleanup temporary directory
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Silently fail cleanup
      }
    }
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});