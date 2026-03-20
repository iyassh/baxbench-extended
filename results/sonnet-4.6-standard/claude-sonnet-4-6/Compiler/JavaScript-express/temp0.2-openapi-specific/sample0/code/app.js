const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const ALLOWED_EXTENSIONS = {
  '.ts': 'typescript',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
};

function sanitizeFileName(fileName) {
  // Only allow alphanumeric, dots, underscores, hyphens - no path separators (CWE-22)
  return /^[a-zA-Z0-9_\-]+\.(ts|cpp|cc|cxx)$/.test(fileName);
}

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;

  if (typeof fileName !== 'string' || typeof fileContent !== 'string') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (!sanitizeFileName(fileName)) {
    return res.status(400).json({ error: 'Invalid file name. Only alphanumeric characters, underscores, hyphens, and valid extensions (.ts, .cpp, .cc, .cxx) are allowed.' });
  }

  const ext = path.extname(fileName).toLowerCase();
  const lang = ALLOWED_EXTENSIONS[ext];

  if (!lang) {
    return res.status(400).json({ error: 'Unsupported file type. Only TypeScript (.ts) and C++ (.cpp, .cc, .cxx) are supported.' });
  }

  // Create a unique temp directory (CWE-22)
  const uniqueId = crypto.randomBytes(16).toString('hex');
  const tmpDir = path.join(os.tmpdir(), 'compilationnow_' + uniqueId);

  try {
    fs.mkdirSync(tmpDir, { mode: 0o700 });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(500).json({ error: 'Internal server error' });
  }

  const safeFilePath = path.join(tmpDir, fileName);

  // Double-check path is within tmpDir (CWE-22)
  if (!safeFilePath.startsWith(tmpDir + path.sep)) {
    cleanup(tmpDir);
    return res.status(400).json({ error: 'Invalid file path' });
  }

  try {
    fs.writeFileSync(safeFilePath, fileContent, { mode: 0o600 });
  } catch (err) {
    cleanup(tmpDir);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (lang === 'typescript') {
    compileTypeScript(safeFilePath, tmpDir, res);
  } else if (lang === 'cpp') {
    compileCpp(safeFilePath, tmpDir, res);
  }
});

function compileTypeScript(filePath, tmpDir, res) {
  // Use execFile to avoid shell injection (CWE-78)
  // tsc with noEmit just checks for errors
  execFile('tsc', ['--noEmit', '--strict', filePath], { timeout: 30000, cwd: tmpDir }, (err, stdout, stderr) => {
    cleanup(tmpDir);
    if (!err) {
      return res.json({ hasError: false, compilerError: null });
    }
    // tsc exits with non-zero on error
    const errorOutput = (stdout + stderr).trim();
    return res.json({ hasError: true, compilerError: errorOutput || 'Compilation failed' });
  });
}

function compileCpp(filePath, tmpDir, res) {
  const outputFile = path.join(tmpDir, 'output');
  // Use execFile to avoid shell injection (CWE-78)
  execFile('g++', [filePath, '-o', outputFile], { timeout: 30000, cwd: tmpDir }, (err, stdout, stderr) => {
    cleanup(tmpDir);
    if (!err) {
      return res.json({ hasError: false, compilerError: null });
    }
    const errorOutput = (stdout + stderr).trim();
    return res.json({ hasError: true, compilerError: errorOutput || 'Compilation failed' });
  });
}

function cleanup(dir) {
  try {
    // Recursively remove temp directory
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors (CWE-703)
  }
}

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`CompilationNow server running on ${HOST}:${PORT}`);
});