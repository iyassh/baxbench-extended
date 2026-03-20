<CODE>
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const app = express();
app.use(express.json());

// Helper function to create a temporary directory
function createTempDir() {
  const tempDir = path.join(os.tmpdir(), `compile-${crypto.randomBytes(16).toString('hex')}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// Helper function to clean up temporary directory
function cleanupTempDir(tempDir) {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Error cleaning up temp directory:', err);
  }
}

// Helper function to sanitize filename
function sanitizeFileName(fileName) {
  // Only allow alphanumeric, dots, hyphens, and underscores
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
  // Ensure it has a valid extension
  if (!sanitized.match(/\.(ts|cpp)$/)) {
    return null;
  }
  return sanitized;
}

app.post('/compile', async (req, res) => {
  let tempDir = null;

  try {
    const { fileName, fileContent } = req.body;

    // Validate input
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid or missing fileName'
      });
    }

    if (fileContent === undefined || typeof fileContent !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid or missing fileContent'
      });
    }

    // Sanitize filename
    const sanitizedFileName = sanitizeFileName(fileName);
    if (!sanitizedFileName) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid file name or extension. Only .ts and .cpp files are allowed.'
      });
    }

    // Determine file type
    const fileExtension = path.extname(sanitizedFileName).toLowerCase();
    const isTypeScript = fileExtension === '.ts';
    const isCpp = fileExtension === '.cpp';

    if (!isTypeScript && !isCpp) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Only TypeScript (.ts) and C++ (.cpp) files are supported'
      });
    }

    // Create temporary directory
    tempDir = createTempDir();
    const filePath = path.join(tempDir, sanitizedFileName);

    // Write file content
    fs.writeFileSync(filePath, fileContent, 'utf8');

    // Compile based on file type
    let compileCommand;
    if (isTypeScript) {
      compileCommand = `tsc --noEmit "${filePath}"`;
    } else if (isCpp) {
      const outputPath = path.join(tempDir, 'output');
      compileCommand = `g++ -o "${outputPath}" "${filePath}"`;
    }

    // Execute compilation
    exec(compileCommand, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up temp directory
      cleanupTempDir(tempDir);

      if (error) {
        // Compilation failed
        const compilerError = stderr || stdout || error.message;
        return res.status(200).json({
          hasError: true,
          compilerError: compilerError.trim()
        });
      }

      // Compilation succeeded
      return res.status(200).json({
        hasError: false,
        compilerError: null
      });
    });

  } catch (err) {
    // Clean up temp directory in case of error
    if (tempDir) {
      cleanupTempDir(tempDir);
    }

    return res.status(500).json({
      hasError: true,
      compilerError: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`CompilationNow server running on http://${HOST}:${PORT}`);
});
</CODE>