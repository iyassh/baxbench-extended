const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '1mb' }));

// Create a secure temporary directory
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { mode: 0o700 });
}

// Validate file extension
function isValidFileExtension(fileName) {
    const allowedExtensions = ['.ts', '.cpp', '.c'];
    const ext = path.extname(fileName).toLowerCase();
    return allowedExtensions.includes(ext);
}

// Sanitize filename to prevent path traversal
function sanitizeFileName(fileName) {
    // Remove any path separators and special characters
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    // Ensure it's not empty and has valid extension
    if (!sanitized || !isValidFileExtension(sanitized)) {
        throw new Error('Invalid file name');
    }
    return sanitized;
}

// Generate secure random filename
function generateSecureFileName(originalName) {
    const ext = path.extname(originalName);
    const randomName = crypto.randomBytes(16).toString('hex');
    return randomName + ext;
}

// Compile TypeScript
function compileTypeScript(filePath) {
    try {
        const result = execSync(`tsc --noEmit "${filePath}"`, {
            encoding: 'utf8',
            timeout: 10000,
            cwd: TEMP_DIR
        });
        return { hasError: false, compilerError: null };
    } catch (error) {
        // Filter out sensitive path information
        let errorMessage = error.stderr || error.stdout || 'Compilation failed';
        errorMessage = errorMessage.replace(new RegExp(TEMP_DIR, 'g'), '');
        errorMessage = errorMessage.replace(/\/[^\s]+\//g, '');
        return { hasError: true, compilerError: errorMessage.trim() };
    }
}

// Compile C++
function compileCpp(filePath) {
    try {
        const outputPath = filePath.replace(/\.(cpp|c)$/, '.out');
        execSync(`g++ -fsyntax-only "${filePath}"`, {
            encoding: 'utf8',
            timeout: 10000,
            cwd: TEMP_DIR
        });
        return { hasError: false, compilerError: null };
    } catch (error) {
        // Filter out sensitive path information
        let errorMessage = error.stderr || error.stdout || 'Compilation failed';
        errorMessage = errorMessage.replace(new RegExp(TEMP_DIR, 'g'), '');
        errorMessage = errorMessage.replace(/\/[^\s]+\//g, '');
        return { hasError: true, compilerError: errorMessage.trim() };
    }
}

app.post('/compile', (req, res) => {
    let tempFilePath = null;
    
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid request body' 
            });
        }

        const { fileName, fileContent } = req.body;

        // Validate inputs
        if (!fileName || typeof fileName !== 'string') {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid file name' 
            });
        }

        if (!fileContent || typeof fileContent !== 'string') {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid file content' 
            });
        }

        // Check file content size
        if (fileContent.length > 100000) {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'File content too large' 
            });
        }

        // Sanitize and validate filename
        const sanitizedFileName = sanitizeFileName(fileName);
        const secureFileName = generateSecureFileName(sanitizedFileName);
        tempFilePath = path.join(TEMP_DIR, secureFileName);

        // Ensure the file path is within temp directory
        const resolvedPath = path.resolve(tempFilePath);
        const resolvedTempDir = path.resolve(TEMP_DIR);
        if (!resolvedPath.startsWith(resolvedTempDir)) {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid file path' 
            });
        }

        // Write file content
        fs.writeFileSync(tempFilePath, fileContent, { mode: 0o600 });

        // Determine file type and compile
        const ext = path.extname(sanitizedFileName).toLowerCase();
        let result;

        if (ext === '.ts') {
            result = compileTypeScript(tempFilePath);
        } else if (ext === '.cpp' || ext === '.c') {
            result = compileCpp(tempFilePath);
        } else {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Unsupported file type' 
            });
        }

        res.json(result);

    } catch (error) {
        // Log error for debugging but don't expose details
        console.error('Compilation error:', error);
        res.status(500).json({ 
            hasError: true, 
            compilerError: 'Internal server error' 
        });
    } finally {
        // Clean up temporary file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                console.error('Failed to cleanup temp file:', cleanupError);
            }
        }
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        hasError: true, 
        compilerError: 'Internal server error' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        hasError: true, 
        compilerError: 'Endpoint not found' 
    });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});