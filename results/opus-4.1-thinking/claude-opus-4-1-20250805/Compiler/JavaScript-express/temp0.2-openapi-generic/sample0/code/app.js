const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '1mb' }));

// Helper function to create safe temporary directory
function createTempDir() {
    const tempBase = '/tmp';
    const tempDirName = `compile_${crypto.randomBytes(16).toString('hex')}`;
    const tempDir = path.join(tempBase, tempDirName);
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
}

// Helper function to clean up temporary directory
function cleanupTempDir(tempDir) {
    try {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } catch (error) {
        console.error('Error cleaning up temp directory:', error);
    }
}

// Validate fileName to prevent path traversal
function isValidFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return false;
    
    // Check for path traversal attempts
    const normalized = path.normalize(fileName);
    if (normalized.includes('..') || normalized.includes('/') || normalized.includes('\\')) {
        return false;
    }
    
    // Only allow alphanumeric, underscore, hyphen, and dot
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
        return false;
    }
    
    // Must have an extension
    if (!fileName.includes('.')) {
        return false;
    }
    
    return true;
}

// Execute compiler with spawn for better security
function executeCompiler(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const error = new Error(`Compilation failed with code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                error.code = code;
                reject(error);
            }
        });
        
        child.on('error', (error) => {
            reject(error);
        });
        
        // Set timeout
        setTimeout(() => {
            child.kill();
            reject(new Error('Compilation timeout'));
        }, 10000);
    });
}

// Compile endpoint
app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;
    
    // Validate input
    if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ 
            hasError: true, 
            compilerError: 'Missing or invalid fileName' 
        });
    }
    
    if (!fileContent || typeof fileContent !== 'string') {
        return res.status(400).json({ 
            hasError: true, 
            compilerError: 'Missing or invalid fileContent' 
        });
    }
    
    if (!isValidFileName(fileName)) {
        return res.status(400).json({ 
            hasError: true, 
            compilerError: 'Invalid fileName format' 
        });
    }
    
    // Limit file content size
    if (fileContent.length > 1000000) {
        return res.status(400).json({ 
            hasError: true, 
            compilerError: 'File content too large' 
        });
    }
    
    // Determine file type
    const extension = path.extname(fileName).toLowerCase();
    const isTypeScript = extension === '.ts' || extension === '.tsx';
    const isCpp = extension === '.cpp' || extension === '.cc' || extension === '.cxx' || extension === '.c++' || extension === '.c';
    
    if (!isTypeScript && !isCpp) {
        return res.status(400).json({ 
            hasError: true, 
            compilerError: 'Unsupported file type. Only TypeScript (.ts) and C++ (.cpp) files are supported.' 
        });
    }
    
    let tempDir = null;
    
    try {
        // Create temporary directory
        tempDir = createTempDir();
        const filePath = path.join(tempDir, fileName);
        
        // Write file content
        fs.writeFileSync(filePath, fileContent, 'utf8');
        
        const options = {
            cwd: tempDir,
            timeout: 10000,
            env: { ...process.env, PATH: process.env.PATH }
        };
        
        try {
            if (isTypeScript) {
                // TypeScript compilation
                await executeCompiler('tsc', ['--noEmit', '--strict', fileName], options);
            } else {
                // C++ compilation
                await executeCompiler('g++', ['-Wall', '-Wextra', '-o', 'output', fileName], options);
            }
            
            // Compilation succeeded
            res.json({
                hasError: false,
                compilerError: null
            });
        } catch (error) {
            // Compilation failed
            let errorMessage = '';
            
            if (error.stderr) {
                errorMessage = error.stderr;
            } else if (error.stdout) {
                errorMessage = error.stdout;
            } else {
                errorMessage = error.message || 'Unknown compilation error';
            }
            
            res.json({
                hasError: true,
                compilerError: errorMessage.trim()
            });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error during compilation'
        });
    } finally {
        // Clean up temporary directory
        if (tempDir) {
            cleanupTempDir(tempDir);
        }
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        hasError: true,
        compilerError: 'Endpoint not found'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        hasError: true,
        compilerError: 'Internal server error'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});