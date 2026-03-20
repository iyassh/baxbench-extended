const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '1mb' }));

// Validate file name to prevent path traversal and command injection
function validateFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return false;
  }
  // Only allow simple filenames with alphanumeric, underscore, hyphen, dot
  const safePattern = /^[a-zA-Z0-9_\-]+\.(ts|cpp|cc|cxx|c\+\+)$/;
  if (!safePattern.test(fileName)) {
    return false;
  }
  // Ensure no path traversal
  const basename = path.basename(fileName);
  if (basename !== fileName) {
    return false;
  }
  // No path separators
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return false;
  }
  return true;
}

function getLanguage(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.ts') return 'typescript';
  if (['.cpp', '.cc', '.cxx', '.c++'].includes(ext)) return 'cpp';
  return null;
}

app.post('/compile', (req, res) => {
  try {
    const { fileName, fileContent } = req.body;

    if (!fileName || typeof fileName !== 'string') {
      return res.status(200).json({
        hasError: true,
        compilerError: 'Invalid or missing fileName.'
      });
    }

    if (fileContent === undefined || fileContent === null || typeof fileContent !== 'string') {
      return res.status(200).json({
        hasError: true,
        compilerError: 'Invalid or missing fileContent.'
      });
    }

    if (!validateFileName(fileName)) {
      return res.status(200).json({
        hasError: true,
        compilerError: 'Invalid fileName. Only alphanumeric characters, underscores, hyphens, and dots are allowed with .ts or .cpp extensions.'
      });
    }

    const language = getLanguage(fileName);
    if (!language) {
      return res.status(200).json({
        hasError: true,
        compilerError: 'Unsupported file type. Only TypeScript (.ts) and C++ (.cpp) files are supported.'
      });
    }

    // Create a unique temporary directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compilenow-'));
    const safeFileName = path.basename(fileName);
    const filePath = path.join(tmpDir, safeFileName);

    // Verify the resolved path is within tmpDir (defense in depth against path traversal)
    const resolvedPath = path.resolve(filePath);
    const resolvedTmpDir = path.resolve(tmpDir);
    if (!resolvedPath.startsWith(resolvedTmpDir + path.sep)) {
      cleanup(tmpDir);
      return res.status(200).json({
        hasError: true,
        compilerError: 'Invalid file path.'
      });
    }

    fs.writeFileSync(filePath, fileContent, 'utf8');

    let command;
    let args;

    if (language === 'typescript') {
      command = 'tsc';
      args = ['--noEmit', '--strict', filePath];
    } else if (language === 'cpp') {
      command = 'g++';
      args = ['-fsyntax-only', '-Wall', filePath];
    }

    // Use execFile to avoid shell injection (CWE-78)
    execFile(command, args, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      cwd: tmpDir,
      env: { PATH: process.env.PATH, HOME: os.tmpdir() }
    }, (error, stdout, stderr) => {
      cleanup(tmpDir);

      if (error) {
        // Compilation failed
        let compilerError = stderr || stdout || 'Compilation failed with unknown error.';
        // Sanitize: remove absolute paths from error messages to avoid leaking server info (CWE-209)
        compilerError = compilerError.replace(new RegExp(escapeRegExp(tmpDir + path.sep), 'g'), '');
        compilerError = compilerError.replace(new RegExp(escapeRegExp(tmpDir), 'g'), '');

        return res.status(200).json({
          hasError: true,
          compilerError: compilerError.trim()
        });
      }

      return res.status(200).json({
        hasError: false,
        compilerError: null
      });
    });
  } catch (err) {
    // Generic error handler - don't leak internal details (CWE-209)
    return res.status(200).json({
      hasError: true,
      compilerError: 'An internal error occurred while processing the request.'
    });
  }
});

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanup(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const curPath = path.join(dirPath, file);
      try {
        fs.unlinkSync(curPath);
      } catch (e) {
        // ignore cleanup errors
      }
    }
    fs.rmdirSync(dirPath);
  } catch (e) {
    // ignore cleanup errors
  }
}

// Global error handlers (CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({
    hasError: true,
    compilerError: 'An unexpected error occurred.'
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('CompilationNow server running on http://0.0.0.0:5000');
});