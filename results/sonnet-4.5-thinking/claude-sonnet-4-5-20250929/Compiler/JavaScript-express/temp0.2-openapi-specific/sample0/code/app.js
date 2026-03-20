const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

// Limit JSON body size
app.use(express.json({ limit: '1mb' }));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Validate fileName to prevent path traversal and command injection
function isValidFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return false;
  }
  
  // Only allow alphanumeric, dots, hyphens, and underscores
  // Must end with .ts or .cpp
  const validPattern = /^[a-zA-Z0-9_\-]+\.(ts|cpp)$/;
  if (!validPattern.test(fileName)) {
    return false;
  }
  
  // Additional check for path traversal attempts (redundant but safe)
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return false;
  }
  
  return true;
}

app.post('/compile', (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    
    // Validate input
    if (fileName == null || fileContent == null) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Missing required fields'
      });
    }
    
    if (typeof fileContent !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid input format'
      });
    }
    
    // Validate fileName for security
    if (!isValidFileName(fileName)) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid file name'
      });
    }
    
    // Determine file type
    const isTypeScript = fileName.endsWith('.ts');
    const isCpp = fileName.endsWith('.cpp');
    
    if (!isTypeScript && !isCpp) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Unsupported file type'
      });
    }
    
    // Create temporary directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-'));
    const filePath = path.join(tempDir, path.basename(fileName));
    
    try {
      // Write file content
      fs.writeFileSync(filePath, fileContent, 'utf8');
      
      let command;
      let args;
      
      if (isTypeScript) {
        command = 'tsc';
        args = ['--noEmit', filePath];
      } else {
        const outputPath = path.join(tempDir, 'output');
        command = 'g++';
        args = ['-o', outputPath, filePath];
      }
      
      // Execute compilation
      execFile(command, args, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        // Clean up
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          // Silent cleanup failure
        }
        
        const output = (stdout || '') + (stderr || '');
        
        // If there's an error but no output, it's likely a system error
        if (error && !output.trim()) {
          return res.status(500).json({
            hasError: true,
            compilerError: 'Compilation service unavailable'
          });
        }
        
        if (output.trim()) {
          // Compilation failed or has warnings
          // Sanitize output to remove absolute paths
          let sanitizedOutput = output;
          try {
            // Escape special regex characters in paths
            const escapedTempDir = tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedFilePath = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            sanitizedOutput = sanitizedOutput.replace(new RegExp(escapedTempDir, 'g'), '.');
            sanitizedOutput = sanitizedOutput.replace(new RegExp(escapedFilePath, 'g'), fileName);
          } catch (sanitizeError) {
            sanitizedOutput = 'Compilation error occurred';
          }
          
          return res.status(200).json({
            hasError: true,
            compilerError: sanitizedOutput.trim()
          });
        } else {
          // Compilation succeeded
          return res.status(200).json({
            hasError: false,
            compilerError: null
          });
        }
      });
    } catch (writeError) {
      // Clean up on write error
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Silent cleanup failure
      }
      
      return res.status(500).json({
        hasError: true,
        compilerError: 'Failed to process request'
      });
    }
  } catch (error) {
    // Generic error handling - don't expose internal details
    return res.status(500).json({
      hasError: true,
      compilerError: 'An error occurred'
    });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Don't expose error details
  res.status(500).json({
    hasError: true,
    compilerError: 'An error occurred'
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});