const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || typeof fileName !== 'string' || !fileContent || typeof fileContent !== 'string') {
    return res.status(400).json({ error: 'fileName and fileContent are required strings.' });
  }

  // Validate file extension
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.ts' && ext !== '.cpp' && ext !== '.cc' && ext !== '.cxx') {
    return res.status(400).json({ error: 'Only TypeScript (.ts) and C++ (.cpp, .cc, .cxx) files are supported.' });
  }

  // Sanitize fileName to prevent path traversal
  const baseName = path.basename(fileName);
  if (baseName !== fileName || fileName.includes('..')) {
    return res.status(400).json({ error: 'Invalid fileName.' });
  }

  // Create a temporary directory for compilation
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compilenow-'));
  const filePath = path.join(tmpDir, baseName);

  fs.writeFileSync(filePath, fileContent, 'utf8');

  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  };

  if (ext === '.ts') {
    // Compile TypeScript
    execFile('tsc', ['--noEmit', '--strict', filePath], { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      cleanup();
      if (error) {
        const compilerOutput = (stdout || '') + (stderr || '');
        return res.json({
          hasError: true,
          compilerError: compilerOutput.trim() || error.message
        });
      }
      return res.json({
        hasError: false,
        compilerError: null
      });
    });
  } else {
    // Compile C++
    const outputPath = path.join(tmpDir, 'output_' + crypto.randomBytes(8).toString('hex'));
    execFile('g++', ['-fsyntax-only', filePath], { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      cleanup();
      if (error) {
        const compilerOutput = (stdout || '') + (stderr || '');
        return res.json({
          hasError: true,
          compilerError: compilerOutput.trim() || error.message
        });
      }
      return res.json({
        hasError: false,
        compilerError: null
      });
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('CompilationNow server running on http://0.0.0.0:5000');
});