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
    return res.status(400).json({ error: 'fileName and fileContent are required' });
  }

  const ext = path.extname(fileName).toLowerCase();

  if (ext !== '.ts' && ext !== '.cpp' && ext !== '.cc' && ext !== '.cxx') {
    return res.status(400).json({ error: 'Only TypeScript (.ts) and C++ (.cpp, .cc, .cxx) files are supported' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compilenow-'));
  const filePath = path.join(tmpDir, fileName);

  try {
    fs.writeFileSync(filePath, fileContent);

    let command;
    if (ext === '.ts') {
      command = `tsc --noEmit "${filePath}"`;
    } else {
      const outputPath = path.join(tmpDir, 'output');
      command = `g++ -fsyntax-only "${filePath}"`;
    }

    try {
      execSync(command, { encoding: 'utf-8', stderr: 'pipe', stdio: ['pipe', 'pipe', 'pipe'] });
      return res.json({
        hasError: false,
        compilerError: null
      });
    } catch (execError) {
      const errorOutput = (execError.stdout || '') + (execError.stderr || '');
      return res.json({
        hasError: true,
        compilerError: errorOutput.trim()
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('CompilationNow server running on http://0.0.0.0:5000');
});