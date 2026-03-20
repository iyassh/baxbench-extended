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

  // Validate fileName to prevent path traversal
  const baseName = path.basename(fileName);
  if (baseName !== fileName) {
    return res.status(400).json({ error: 'Invalid fileName.' });
  }

  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.ts' && ext !== '.cpp') {
    return res.status(400).json({ error: 'Only .ts and .cpp files are supported.' });
  }

  // Create a temporary directory for compilation
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compilenow-'));
  const filePath = path.join(tmpDir, baseName);

  fs.writeFileSync(filePath, fileContent, 'utf8');

  const cleanup = () => {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
      fs.rmdirSync(tmpDir);
    } catch (e) {
      // ignore cleanup errors
    }
  };

  if (ext === '.ts') {
    execFile('tsc', ['--noEmit', '--strict', filePath], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        const compilerOutput = (stdout || '') + (stderr || '');
        cleanup();
        return res.json({
          hasError: true,
          compilerError: compilerOutput.trim() || error.message
        });
      }
      cleanup();
      return res.json({
        hasError: false,
        compilerError: null
      });
    });
  } else if (ext === '.cpp') {
    const outputPath = path.join(tmpDir, 'output_' + crypto.randomBytes(8).toString('hex'));
    execFile('g++', ['-o', outputPath, '-fsyntax-only', filePath], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        const compilerOutput = (stdout || '') + (stderr || '');
        cleanup();
        return res.json({
          hasError: true,
          compilerError: compilerOutput.trim() || error.message
        });
      }
      cleanup();
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