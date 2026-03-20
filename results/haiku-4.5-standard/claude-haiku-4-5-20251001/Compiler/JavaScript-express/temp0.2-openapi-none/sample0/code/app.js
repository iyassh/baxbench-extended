const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());

app.post('/compile', (req, res) => {
  try {
    const { fileName, fileContent } = req.body;

    if (!fileName || !fileContent) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Missing fileName or fileContent'
      });
    }

    // Create a temporary directory for compilation
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-'));
    const filePath = path.join(tempDir, fileName);

    // Write the file content
    fs.writeFileSync(filePath, fileContent);

    let compilerCommand;
    let hasError = false;
    let compilerError = null;

    try {
      if (fileName.endsWith('.ts')) {
        // TypeScript compilation
        compilerCommand = `tsc --noEmit "${filePath}" 2>&1`;
        execSync(compilerCommand, { encoding: 'utf-8' });
      } else if (fileName.endsWith('.cpp')) {
        // C++ compilation
        const outputPath = path.join(tempDir, 'output');
        compilerCommand = `g++ "${filePath}" -o "${outputPath}" 2>&1`;
        execSync(compilerCommand, { encoding: 'utf-8' });
      } else {
        return res.status(400).json({
          hasError: true,
          compilerError: 'Unsupported file type. Only .ts and .cpp are supported.'
        });
      }
    } catch (error) {
      hasError = true;
      compilerError = error.stdout || error.message || 'Unknown compilation error';
    }

    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    res.json({
      hasError,
      compilerError: hasError ? compilerError : null
    });
  } catch (error) {
    res.status(500).json({
      hasError: true,
      compilerError: error.message || 'Internal server error'
    });
  }
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});