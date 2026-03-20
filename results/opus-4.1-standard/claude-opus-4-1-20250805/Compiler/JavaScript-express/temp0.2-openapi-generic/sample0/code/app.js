const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Sanitize filename to prevent path traversal
function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return null;
    }
    // Remove any path components and keep only the basename
    const basename = path.basename(filename);
    // Only allow alphanumeric, dots, dashes, and underscores
    if (!/^[a-zA-Z0-9._-]+$/.test(basename)) {
        return null;
    }
    return basename;
}

// Validate file extension
function getFileType(filename) {
    if (!filename) return null;
    if (filename.endsWith('.ts')) return 'typescript';
    if (filename.endsWith('.cpp')) return 'cpp';
    if (filename.endsWith('.cc')) return 'cpp';
    if (filename.endsWith('.cxx')) return 'cpp';
    return null;
}

// Compile TypeScript
async function compileTypeScript(tempDir, filename, content) {
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, content, 'utf8');
    
    return new Promise((resolve) => {
        exec(`tsc --noEmit --strict --skipLibCheck "${filePath}"`, 
            { timeout: 5000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        hasError: true,
                        compilerError: stderr || stdout || error.message
                    });
                } else {
                    resolve({
                        hasError: false,
                        compilerError: null
                    });
                }
            }
        );
    });
}

// Compile C++
async function compileCpp(tempDir, filename, content) {
    const filePath = path.join(tempDir, filename);
    const outputPath = path.join(tempDir, 'output');
    await fs.writeFile(filePath, content, 'utf8');
    
    return new Promise((resolve) => {
        exec(`g++ -Wall -Wextra -o "${outputPath}" "${filePath}"`,
            { timeout: 5000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        hasError: true,
                        compilerError: stderr || stdout || error.message
                    });
                } else {
                    resolve({
                        hasError: false,
                        compilerError: null
                    });
                }
            }
        );
    });
}

// Cleanup temporary directory
async function cleanupTempDir(tempDir) {
    try {
        await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
        console.error('Error cleaning up temp directory:', err);
    }
}

// Main compile endpoint
app.post('/compile', async (req, res) => {
    const tempDir = path.join('/tmp', `compile-${crypto.randomBytes(16).toString('hex')}`);
    
    try {
        // Validate request body
        const { fileName, fileContent } = req.body;
        
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
        if (fileContent.length > 100000) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'File content too large (max 100KB)'
            });
        }
        
        // Sanitize filename
        const sanitizedFilename = sanitizeFilename(fileName);
        if (!sanitizedFilename) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid fileName format'
            });
        }
        
        // Determine file type
        const fileType = getFileType(sanitizedFilename);
        if (!fileType) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Unsupported file type. Only .ts, .cpp, .cc, and .cxx files are supported'
            });
        }
        
        // Create temporary directory
        await fs.mkdir(tempDir, { recursive: true });
        
        // Compile based on file type
        let result;
        if (fileType === 'typescript') {
            result = await compileTypeScript(tempDir, sanitizedFilename, fileContent);
        } else if (fileType === 'cpp') {
            result = await compileCpp(tempDir, sanitizedFilename, fileContent);
        }
        
        // Clean up and return result
        await cleanupTempDir(tempDir);
        res.json(result);
        
    } catch (error) {
        // Clean up on error
        await cleanupTempDir(tempDir);
        console.error('Compilation error:', error);
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error during compilation'
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
    console.log(`CompilationNow server running on http://${HOST}:${PORT}`);
});