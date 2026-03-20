const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const execAsync = promisify(exec);

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
    
    // Only allow alphanumeric, dots, dashes, and underscores
    const validFileNameRegex = /^[a-zA-Z0-9._-]+$/;
    if (!validFileNameRegex.test(fileName)) {
        return false;
    }
    
    // Check for path traversal attempts
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return false;
    }
    
    // Only allow .ts and .cpp extensions
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.ts' && ext !== '.cpp') {
        return false;
    }
    
    return true;
};

const validateFileContent = (fileContent) => {
    if (!fileContent || typeof fileContent !== 'string') {
        return false;
    }
    
    // Limit file content size (100KB)
    if (fileContent.length > 100000) {
        return false;
    }
    
    return true;
};

// Sanitize compiler output
const sanitizeOutput = (output) => {
    if (!output) return null;
    
    // Remove any potential sensitive paths or system information
    let sanitized = output.toString();
    
    // Remove absolute paths, keep only relative ones
    sanitized = sanitized.replace(/\/[^\s]+\/temp_[a-f0-9]+\//g, '');
    sanitized = sanitized.replace(/[A-Z]:\\[^\s]+\\temp_[a-f0-9]+\\/g, '');
    
    // Remove system-specific information
    sanitized = sanitized.replace(/\/usr\/[^\s]+/g, '[system-path]');
    sanitized = sanitized.replace(/\/home\/[^\s]+/g, '[user-path]');
    
    // Limit output size
    if (sanitized.length > 10000) {
        sanitized = sanitized.substring(0, 10000) + '\n... (output truncated)';
    }
    
    return sanitized;
};

app.post('/compile', async (req, res) => {
    let tempDir = null;
    
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
        
        // Create temporary directory with random name
        const tempDirName = `temp_${crypto.randomBytes(16).toString('hex')}`;
        tempDir = path.join('/tmp', tempDirName);
        await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
        
        // Write file to temporary directory
        const filePath = path.join(tempDir, path.basename(fileName));
        await fs.writeFile(filePath, fileContent, 'utf8');
        
        // Determine compiler command based on file extension
        const ext = path.extname(fileName).toLowerCase();
        let command;
        
        if (ext === '.ts') {
            // TypeScript compilation
            command = `tsc --noEmit --strict --skipLibCheck "${path.basename(fileName)}"`;
        } else if (ext === '.cpp') {
            // C++ compilation
            command = `g++ -Wall -Wextra -fsyntax-only "${path.basename(fileName)}"`;
        } else {
            throw new Error('Unsupported file type');
        }
        
        // Execute compilation with timeout and resource limits
        const options = {
            cwd: tempDir,
            timeout: 5000, // 5 second timeout
            maxBuffer: 1024 * 1024, // 1MB max output
            env: {
                PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                HOME: tempDir
            }
        };
        
        try {
            await execAsync(command, options);
            // Compilation succeeded
            res.json({
                hasError: false,
                compilerError: null
            });
        } catch (compileError) {
            // Compilation failed
            if (compileError.killed || compileError.signal === 'SIGTERM') {
                res.json({
                    hasError: true,
                    compilerError: 'Compilation timeout exceeded'
                });
            } else {
                const errorOutput = compileError.stderr || compileError.stdout || 'Compilation failed';
                res.json({
                    hasError: true,
                    compilerError: sanitizeOutput(errorOutput)
                });
            }
        }
        
    } catch (error) {
        console.error('Server error:', error.message);
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error'
        });
    } finally {
        // Clean up temporary directory
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error('Failed to clean up temp directory:', cleanupError.message);
            }
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({
        hasError: true,
        compilerError: 'Internal server error'
    });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        hasError: true,
        compilerError: 'Endpoint not found'
    });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`CompilationNow server running on ${HOST}:${PORT}`);
});