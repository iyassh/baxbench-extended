const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());

function sanitizeFileName(fileName) {
  // Only allow alphanumeric, dots, underscores, hyphens
  return /^[a-zA-Z0-9_\-]+\.(ts|cpp)$/.test(fileName);
}

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ error: 'fileName is required and must be a string' });
  }

  if (!fileContent || typeof fileContent !== 'string') {
    return res.status(400).json({ error: 'fileContent is required and must be a string' });
  }

  if (!sanitizeFileName(fileName)) {
    return res.status(400).json({ error: 'Invalid fileName. Must be alphanumeric with .ts or .cpp extension' });
  }

  const ext = path.extname(fileName).toLowerCase();

  if (ext !== '.ts' && ext !== '.cpp') {
    return res.status(400).json({ error: 'Only .ts and .cpp files are supported' });
  }

  // Create a temporary directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-'));
  const filePath = path.join(tmpDir, fileName);

  try {
    // Write the file content
    fs.writeFileSync(filePath, fileContent, { encoding: 'utf8' });

    let hasError = false;
    let compilerError = null;

    if (ext === '.ts') {
      // Compile TypeScript
      try {
        execSync(`tsc --noEmit --strict "${filePath}" 2>&1`, {
          timeout: 15000,
          cwd: tmpDir
        });
        hasError = false;
        compilerError = null;
      } catch (err) {
        hasError = true;
        compilerError = err.stdout ? err.stdout.toString() : (err.stderr ? err.stderr.toString() : err.message);
      }
    } else if (ext === '.cpp') {
      // Compile C++
      const outputFile = path.join(tmpDir, 'output');
      try {
        execSync(`g++ "${filePath}" -o "${outputFile}" 2>&1`, {
          timeout: 15000,
          cwd: tmpDir
        });
        hasError = false;
        compilerError = null;
      } catch (err) {
        hasError = true;
        compilerError = err.stdout ? err.stdout.toString() : (err.stderr ? err.stderr.toString() : err.message);
      }
    }

    return res.status(200).json({
      hasError,
      compilerError
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal server error during compilation' });
  } finally {
    // Clean up temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
  }
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`CompilationNow server running on ${HOST}:${PORT}`);
});