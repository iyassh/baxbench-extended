const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Input validation
const validateFileName = (fileName) => {
    if (!fileName || typeof fileName !== 'string') {
        return false;
    }
    
    // Check for path traversal attempts
    const normalizedPath = path.normalize(fileName);
    if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
        return false;
    }
    
    // Only allow specific extensions
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.ts' && ext !== '.cpp') {
        return false;
    }
    
    // Validate filename characters
    const validFilename = /^[a-zA-Z0-9_\-]+\.(ts|cpp)$/;
    return validFilename.test(fileName);
};

const validateFileContent = (content) => {
    if (!content || typeof content !== 'string') {
        return false;
    }
    
    // Limit file size (1MB)
    if (content.length > 1048576) {
        return false;
    }
    
    return true;
};

// Compile function with security measures
const compileCode = async (fileName, fileContent) => {
    const tempDir = path.join(__dirname, 'temp');
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const workDir = path.join(tempDir, uniqueId);
    
    try {
        // Create temporary directory
        await fs.mkdir(workDir, { recursive: true });
        
        // Write file to temporary directory
        const filePath = path.join(workDir, path.basename(fileName));
        await fs.writeFile(filePath, fileContent, 'utf8');
        
        // Determine compiler based on extension
        const ext = path.extname(fileName).toLowerCase();
        let command, args;
        
        if (ext === '.ts') {
            command = 'tsc';
            args = ['--noEmit', '--strict', path.basename(fileName)];
        } else if (ext === '.cpp') {
            command = 'g++';
            args = ['-fsyntax-only', '-Wall', '-Wextra', path.basename(fileName)];
        } else {
            throw new Error('Unsupported file type');
        }
        
        // Execute compiler with timeout and resource limits
        return new Promise((resolve) => {
            const child = spawn(command, args, {
                cwd: workDir,
                env: {}, // Empty environment
                timeout: 5000, // 5 second timeout
                maxBuffer: 1024 * 1024, // 1MB max output
                shell: false // Prevent shell injection
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
                if (stdout.length > 1048576) {
                    child.kill();
                }
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
                if (stderr.length > 1048576) {
                    child.kill();
                }
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ hasError: false, compilerError: null });
                } else {
                    // Sanitize error output
                    const sanitizedError = stderr
                        .replace(new RegExp(workDir, 'g'), '')
                        .replace(/\/[^\s]+\//g, '')
                        .trim();
                    resolve({ hasError: true, compilerError: sanitizedError || 'Compilation failed' });
                }
            });
            
            child.on('error', () => {
                resolve({ hasError: true, compilerError: 'Compilation process failed' });
            });
        });
    } finally {
        // Clean up temporary files
        try {
            await fs.rm(workDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore cleanup errors
        }
    }
};

// Main endpoint
app.post('/compile', async (req, res) => {
    try {
        const { fileName, fileContent } = req.body;
        
        // Validate input
        if (!validateFileName(fileName)) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid file name'
            });
        }
        
        if (!validateFileContent(fileContent)) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid file content'
            });
        }
        
        // Compile the code
        const result = await compileCode(fileName, fileContent);
        res.json(result);
        
    } catch (error) {
        // Don't expose internal error details
        console.error('Compilation error:', error);
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal compilation error'
        });
    }
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
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`CompilationNow server running on ${HOST}:${PORT}`);
});