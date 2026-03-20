const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '1mb' }));

// Validate file extension
function isValidFileExtension(fileName) {
  const validExtensions = ['.ts', '.cpp'];
  const ext = path.extname(fileName).toLowerCase();
  return validExtensions.includes(ext);
}

// Sanitize file name to prevent path traversal
function sanitizeFileName(fileName) {
  // Remove any path separators and null bytes
  const sanitized = path.basename(fileName).replace(/\0/g, '');
  return sanitized;
}

// Compile TypeScript
function compileTypeScript(filePath, fileName) {
  try {
    const result = execSync(`npx tsc --noEmit "${filePath}" 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { hasError: false, compilerError: null };
  } catch (error) {
    const errorOutput = error.stdout || error.message || 'Unknown error';
    // Filter out sensitive paths, only show file-relative errors
    const sanitizedError = errorOutput
      .split('\n')
      .filter(line => line.includes(fileName))
      .join('\n')
      .trim();
    return {
      hasError: true,
      compilerError: sanitizedError || 'Compilation failed',
    };
  }
}

// Compile C++
function compileCpp(filePath, fileName) {
  try {
    const outputPath = filePath.replace(/\.[^.]+$/, '');
    execSync(`g++ -c "${filePath}" -o "${outputPath}.o" 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { hasError: false, compilerError: null };
  } catch (error) {
    const errorOutput = error.stdout || error.message || 'Unknown error';
    // Filter out sensitive paths, only show file-relative errors
    const sanitizedError = errorOutput
      .split('\n')
      .filter(line => line.includes(fileName))
      .join('\n')
      .trim();
    return {
      hasError: true,
      compilerError: sanitizedError || 'Compilation failed',
    };
  }
}

app.post('/compile', (req, res) => {
  try {
    const { fileName, fileContent } = req.body;

    // Input validation
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid fileName parameter',
      });
    }

    if (!fileContent || typeof fileContent !== 'string') {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid fileContent parameter',
      });
    }

    // Validate file size (max 1MB)
    if (fileContent.length > 1024 * 1024) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'File content exceeds maximum size',
      });
    }

    // Sanitize and validate file name
    const sanitizedFileName = sanitizeFileName(fileName);
    if (!isValidFileExtension(sanitizedFileName)) {
      return res.status(400).json({
        hasError: true,
        compilerError: 'Invalid file extension. Only .ts and .cpp are supported',
      });
    }

    // Create temporary directory with unique ID
    const tempDir = path.join(os.tmpdir(), `compilation-${uuidv4()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Ensure the temp directory is actually under os.tmpdir()
    const resolvedTempDir = fs.realpathSync(tempDir);
    const tmpDirReal = fs.realpathSync(os.tmpdir());
    if (!resolvedTempDir.startsWith(tmpDirReal)) {
      throw new Error('Invalid temporary directory');
    }

    const filePath = path.join(tempDir, sanitizedFileName);

    // Ensure the file path is within the temp directory (CWE-22 prevention)
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedTempDir)) {
      throw new Error('Path traversal detected');
    }

    // Write file
    fs.writeFileSync(filePath, fileContent, 'utf-8');

    let result;
    const ext = path.extname(sanitizedFileName).toLowerCase();

    if (ext === '.ts') {
      result = compileTypeScript(filePath, sanitizedFileName);
    } else if (ext === '.cpp') {
      result = compileCpp(filePath, sanitizedFileName);
    }

    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Log but don't fail the response
      console.error('Cleanup error:', cleanupError.message);
    }

    res.json(result);
  } catch (error) {
    // Don't expose internal error details (CWE-209)
    console.error('Compilation error:', error.message);
    res.status(500).json({
      hasError: true,
      compilerError: 'Internal server error',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    hasError: true,
    compilerError: 'Internal server error',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});