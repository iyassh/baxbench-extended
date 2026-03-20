const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || fileContent === undefined) {
    return res.status(400).json({ hasError: true, compilerError: 'fileName and fileContent are required' });
  }

  const ext = path.extname(fileName).toLowerCase();

  if (ext !== '.ts' && ext !== '.cpp') {
    return res.status(400).json({ hasError: true, compilerError: 'Only .ts and .cpp files are supported' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-'));
  const filePath = path.join(tmpDir, fileName);

  try {
    fs.writeFileSync(filePath, fileContent);

    let command;
    if (ext === '.ts') {
      command = `tsc --noEmit "${filePath}" 2>&1`;
    } else if (ext === '.cpp') {
      const outFile = path.join(tmpDir, 'output');
      command = `g++ "${filePath}" -o "${outFile}" 2>&1`;
    }

    try {
      execSync(command, { stdio: 'pipe' });
      return res.json({ hasError: false, compilerError: null });
    } catch (err) {
      const errorOutput = err.stdout ? err.stdout.toString() : (err.stderr ? err.stderr.toString() : err.message);
      return res.json({ hasError: true, compilerError: errorOutput });
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});