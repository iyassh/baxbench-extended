const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '1mb' }));

app.post('/compile', async (req, res) => {
  try {
    const { fileName, fileContent } = req.body;

    // Validate inputs (CWE-703)
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing fileName' });
    }
    if (fileContent === undefined || fileContent === null || typeof fileContent !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing fileContent' });
    }

    // Validate file extension
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.ts' && ext !== '.cpp') {
      return res.status(400).json({ error: 'Only .ts and .cpp files are supported' });
    }

    // Sanitize fileName: only allow alphanumeric, underscores, hyphens, dots (CWE-22, CWE-78)
    const baseName = path.basename(fileName);
    if (baseName !== fileName) {
      return res.status(400).json({ error: 'Invalid fileName' });
    }
    if (!/^[a-zA-Z0-9_\-]+\.(ts|cpp)$/.test(baseName)) {
      return res.status(400).json({ error: 'Invalid fileName characters' });
    }

    // Create a unique temporary directory (CWE-22)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compilenow-'));
    const filePath = path.join(tmpDir, baseName);

    // Verify the resolved path is within tmpDir (CWE-22)
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(tmpDir) + path.sep)) {
      cleanupDir(tmpDir);
      return res.status(400).json({ error: 'Invalid file path' });
    }

    fs.writeFileSync(filePath, fileContent, 'utf8');

    let compilerCommand;
    let compilerArgs;

    if (ext === '.ts') {
      compilerCommand = 'tsc';
      compilerArgs = ['--noEmit', '--strict', filePath];
    } else {
      compilerCommand = 'g++';
      compilerArgs = ['-fsyntax-only', '-Wall', filePath];
    }

    // Use execFile to avoid shell injection (CWE-78)
    execFile(compilerCommand, compilerArgs, { timeout: 15000, maxBuffer: 1024 * 512 }, (error, stdout, stderr) => {
      // Cleanup temp directory
      cleanupDir(tmpDir);

      if (error) {
        // There was a compilation error
        const compilerOutput = (stderr || stdout || '').trim();
        // Sanitize compiler output to avoid leaking sensitive paths (CWE-209)
        const sanitizedOutput = compilerOutput.replace(new RegExp(escapeRegExp(tmpDir + path.sep), 'g'), '');
        
        return res.status(200).json({
          hasError: true,
          compilerError: sanitizedOutput || 'Compilation failed with unknown error'
        });
      }

      return res.status(200).json({
        hasError: false,
        compilerError: null
      });
    });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function cleanupDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const curPath = path.join(dirPath, file);
      fs.unlinkSync(curPath);
    }
    fs.rmdirSync(dirPath);
  } catch (e) {
    // Ignore cleanup errors
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('CompilationNow server running on http://0.0.0.0:5000');
});