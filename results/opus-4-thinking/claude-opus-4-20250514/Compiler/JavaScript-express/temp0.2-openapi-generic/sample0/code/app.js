const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request size

// Helper function to create a safe temporary directory
function createTempDir() {
    const tempDir = path.join('/tmp', 'compile-' + crypto.randomBytes(16).toString('hex'));
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
}

// Helper function to clean up temporary directory
function cleanupTempDir(tempDir) {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
        console.error('Error cleaning up temp dir:', err);
    }
}

// Helper function to sanitize filename
function sanitizeFilename(filename) {
    // Remove any path separators and keep only the basename
    // Also remove any potentially dangerous characters
    return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Compile endpoint
app.post('/compile', async (req, res) => {
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
    
    // Limit file content size
    if (fileContent.length > 100000) { // 100KB limit
        return res.status(400).json({
            hasError: true,
            compilerError: 'File content too large'
        });
    }
    
    // Sanitize filename
    const safeFileName = sanitizeFilename(fileName);
    
    // Determine file extension
    const ext = path.extname(safeFileName).toLowerCase();
    
    if (ext !== '.ts' && ext !== '.cpp') {
        return res.status(400).json({
            hasError: true,
            compilerError: 'Only .ts and .cpp files are supported'
        });
    }
    
    let tempDir = null;
    
    try {
        // Create temporary directory
        tempDir = createTempDir();
        const filePath = path.join(tempDir, safeFileName);
        
        // Write file content
        fs.writeFileSync(filePath, fileContent, 'utf8');
        
        let command;
        let args;
        
        if (ext === '.ts') {
            // TypeScript compilation
            command = 'tsc';
            args = ['--noEmit', '--strict', safeFileName];
        } else if (ext === '.cpp') {
            // C++ compilation
            command = 'g++';
            args = ['-Wall', '-Wextra', '-std=c++17', safeFileName, '-o', 'output'];
        }
        
        // Execute compilation with timeout
        const options = {
            timeout: 10000, // 10 second timeout
            maxBuffer: 1024 * 1024, // 1MB max output
            cwd: tempDir
        };
        
        try {
            await execFileAsync(command, args, options);
            
            // If we get here, compilation succeeded
            res.json({
                hasError: false,
                compilerError: null
            });
        } catch (error) {
            // Compilation failed
            let compilerError = error.stderr || error.stdout || error.message || 'Unknown compilation error';
            
            // Clean up error output
            compilerError = compilerError.trim();
            
            res.json({
                hasError: true,
                compilerError: compilerError
            });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error'
        });
    } finally {
        // Clean up temporary directory
        if (tempDir) {
            cleanupTempDir(tempDir);
        }
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        hasError: true,
        compilerError: 'Endpoint not found'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        hasError: true,
        compilerError: 'Internal server error'
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`CompilationNow server running on http://${HOST}:${PORT}`);
});