const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const app = express();
const execFileAsync = promisify(execFile);

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request size

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Create temp directory if it doesn't exist
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { mode: 0o700 });
}

// Validate and sanitize filename
function validateFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return { valid: false, error: 'Invalid filename' };
    }
    
    // Only allow alphanumeric, dots, dashes, and underscores
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    
    // Must have an extension
    const ext = path.extname(sanitized).toLowerCase();
    
    // Only allow .ts and .cpp extensions
    if (ext !== '.ts' && ext !== '.cpp') {
        return { valid: false, error: 'Only .ts and .cpp files are supported' };
    }
    
    // Prevent path traversal
    if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
        return { valid: false, error: 'Invalid filename' };
    }
    
    return { valid: true, fileName: sanitized, ext };
}

// Compile endpoint
app.post('/compile', async (req, res) => {
    let tempFilePath = null;
    let tempOutputPath = null;
    
    try {
        const { fileName, fileContent } = req.body;
        
        // Validate input
        if (!fileName || !fileContent) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Missing required fields: fileName and fileContent'
            });
        }
        
        // Validate file content
        if (typeof fileContent !== 'string' || fileContent.length > 100000) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid file content'
            });
        }
        
        // Validate filename
        const validation = validateFileName(fileName);
        if (!validation.valid) {
            return res.status(400).json({
                hasError: true,
                compilerError: validation.error
            });
        }
        
        // Generate unique temporary filename
        const tempId = crypto.randomBytes(16).toString('hex');
        const tempFileName = `${tempId}_${validation.fileName}`;
        tempFilePath = path.join(TEMP_DIR, tempFileName);
        
        // Write content to temp file
        await fs.promises.writeFile(tempFilePath, fileContent, { mode: 0o600 });
        
        let compilerResult;
        
        if (validation.ext === '.ts') {
            // TypeScript compilation
            try {
                compilerResult = await execFileAsync('tsc', [
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    tempFilePath
                ], {
                    timeout: 10000,
                    cwd: TEMP_DIR
                });
                
                // If we get here, compilation succeeded
                res.json({
                    hasError: false,
                    compilerError: null
                });
            } catch (error) {
                // TypeScript compilation failed
                if (error.code === 'ETIMEDOUT') {
                    res.json({
                        hasError: true,
                        compilerError: 'Compilation timeout'
                    });
                } else if (error.stderr) {
                    // Clean the error output to remove absolute paths
                    const cleanError = error.stderr.replace(new RegExp(path.dirname(tempFilePath) + '/', 'g'), '')
                                                  .replace(new RegExp(tempId + '_', 'g'), '');
                    res.json({
                        hasError: true,
                        compilerError: cleanError.trim()
                    });
                } else {
                    res.json({
                        hasError: true,
                        compilerError: 'Compilation failed'
                    });
                }
            }
        } else if (validation.ext === '.cpp') {
            // C++ compilation
            tempOutputPath = path.join(TEMP_DIR, `${tempId}_output`);
            
            try {
                compilerResult = await execFileAsync('g++', [
                    '-o',
                    tempOutputPath,
                    '-Wall',
                    '-Werror',
                    tempFilePath
                ], {
                    timeout: 10000,
                    cwd: TEMP_DIR
                });
                
                // If we get here, compilation succeeded
                res.json({
                    hasError: false,
                    compilerError: null
                });
            } catch (error) {
                // C++ compilation failed
                if (error.code === 'ETIMEDOUT') {
                    res.json({
                        hasError: true,
                        compilerError: 'Compilation timeout'
                    });
                } else if (error.stderr) {
                    // Clean the error output to remove absolute paths
                    const cleanError = error.stderr.replace(new RegExp(path.dirname(tempFilePath) + '/', 'g'), '')
                                                  .replace(new RegExp(tempId + '_', 'g'), '');
                    res.json({
                        hasError: true,
                        compilerError: cleanError.trim()
                    });
                } else {
                    res.json({
                        hasError: true,
                        compilerError: 'Compilation failed'
                    });
                }
            }
        }
        
    } catch (error) {
        // Handle any unexpected errors
        console.error('Unexpected error:', error.message);
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error'
        });
    } finally {
        // Clean up temp files
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                await fs.promises.unlink(tempFilePath);
            } catch (e) {
                console.error('Failed to delete temp file:', e.message);
            }
        }
        if (tempOutputPath && fs.existsSync(tempOutputPath)) {
            try {
                await fs.promises.unlink(tempOutputPath);
            } catch (e) {
                console.error('Failed to delete output file:', e.message);
            }
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({
        hasError: true,
        compilerError: 'Internal server error'
    });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});