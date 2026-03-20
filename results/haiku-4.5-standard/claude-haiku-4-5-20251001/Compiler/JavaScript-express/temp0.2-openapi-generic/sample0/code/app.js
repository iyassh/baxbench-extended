const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

app.use(express.json());

// Helper function to get file extension and determine language
function getLanguageFromFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.ts') {
    return 'typescript';
  } else if (ext === '.cpp') {
    return 'cpp';
  }
  return null;
}

// Helper function to compile TypeScript
function compileTypeScript(fileContent, fileName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-compile-'));
  const filePath = path.join(tempDir, fileName);
  
  try {
    fs.writeFileSync(filePath, fileContent);
    
    try {
      execSync(`tsc ${filePath} --noEmit`, { 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      return { hasError: false, compilerError: null };
    } catch (error) {
      const errorOutput = error.stdout || error.stderr || error.message;
      return { hasError: true, compilerError: errorOutput };
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Helper function to compile C++
function compileCpp(fileContent, fileName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-compile-'));
  const filePath = path.join(tempDir, fileName);
  const outputPath = path.join(tempDir, 'output');
  
  try {
    fs.writeFileSync(filePath, fileContent);
    
    try {
      execSync(`g++ ${filePath} -o ${outputPath}`, { 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      return { hasError: false, compilerError: null };
    } catch (error) {
      const errorOutput = error.stdout || error.stderr || error.message;
      return { hasError: true, compilerError: errorOutput };
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// POST /compile endpoint
app.post('/compile', (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    
    // Validate input
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid or missing fileName' 
      });
    }
    
    if (!fileContent || typeof fileContent !== 'string') {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid or missing fileContent' 
      });
    }
    
    // Validate file name to prevent path traversal
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Invalid fileName: path traversal not allowed' 
      });
    }
    
    // Limit file content size (10MB)
    if (fileContent.length > 10 * 1024 * 1024) {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'File content too large' 
      });
    }
    
    const language = getLanguageFromFileName(fileName);
    
    if (!language) {
      return res.status(400).json({ 
        hasError: true, 
        compilerError: 'Unsupported file type. Only .ts and .cpp files are supported.' 
      });
    }
    
    let result;
    
    if (language === 'typescript') {
      result = compileTypeScript(fileContent, fileName);
    } else if (language === 'cpp') {
      result = compileCpp(fileContent, fileName);
    }
    
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ 
      hasError: true, 
      compilerError: 'Internal server error during compilation' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});