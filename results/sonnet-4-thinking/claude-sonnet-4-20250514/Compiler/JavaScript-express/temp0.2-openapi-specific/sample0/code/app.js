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
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '1mb' }));

// Validate file name to prevent path traversal
function validateFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return false;
    }
    
    // Remove any path components
    const baseName = path.basename(fileName);
    
    // Check if it's a valid file name (alphanumeric + dots, underscores, hyphens)
    if (!/^[a-zA-Z0-9._-]+$/.test(baseName)) {
        return false;
    }
    
    // Check file extension
    const ext = path.extname(baseName).toLowerCase();
    if (ext !== '.ts' && ext !== '.cpp') {
        return false;
    }
    
    return baseName;
}

// Compile TypeScript
function compileTypeScript(content, tempFileName) {
    try {
        // Write content to temporary file
        fs.writeFileSync(tempFileName, content, 'utf8');
        
        // Compile with tsc - tempFileName is safe due to validation
        execSync(`tsc --noEmit "${tempFileName}"`, { 
            encoding: 'utf8',
            timeout: 10000,
            maxBuffer: 1024 * 1024 // 1MB buffer
        });
        
        return { hasError: false, compilerError: null };
    } catch (error) {
        // TypeScript compiler outputs errors to stderr
        let errorOutput = '';
        if (error.stderr) {
            errorOutput = error.stderr;
        } else if (error.stdout) {
            errorOutput = error.stdout;
        } else if (error.message) {
            errorOutput = error.message;
        } else {
            errorOutput = 'Unknown compilation error';
        }
        
        // Sanitize error message to remove sensitive paths
        let sanitizedError = errorOutput.replace(/\/tmp\/compile_[a-f0-9]+\.ts/g, path.basename(tempFileName));
        
        // Limit error message length
        if (sanitizedError.length > 2000) {
            sanitizedError = sanitizedError.substring(0, 2000) + '...';
        }
        
        return { hasError: true, compilerError: sanitizedError };
    }
}

// Compile C++
function compileCpp(content, tempFileName) {
    try {
        // Write content to temporary file
        fs.writeFileSync(tempFileName, content, 'utf8');
        
        const outputFile = tempFileName.replace('.cpp', '.out');
        
        // Compile with g++ - tempFileName is safe due to validation
        execSync(`g++ -o "${outputFile}" "${tempFileName}"`, { 
            encoding: 'utf8',
            timeout: 10000,
            maxBuffer: 1024 * 1024 // 1MB buffer
        });
        
        // Clean up output file
        try {
            fs.unlinkSync(outputFile);
        } catch (e) {
            // Ignore cleanup errors
        }
        
        return { hasError: false, compilerError: null };
    } catch (error) {
        // g++ outputs errors to stderr
        let errorOutput = '';
        if (error.stderr) {
            errorOutput = error.stderr;
        } else if (error.stdout) {
            errorOutput = error.stdout;
        } else if (error.message) {
            errorOutput = error.message;
        } else {
            errorOutput = 'Unknown compilation error';
        }
        
        // Sanitize error message to remove sensitive paths
        let sanitizedError = errorOutput.replace(/\/tmp\/compile_[a-f0-9]+\.cpp/g, path.basename(tempFileName));
        
        // Limit error message length
        if (sanitizedError.length > 2000) {
            sanitizedError = sanitizedError.substring(0, 2000) + '...';
        }
        
        return { hasError: true, compilerError: sanitizedError };
    }
}

app.post('/compile', (req, res) => {
    let tempFileName = null;
    
    try {
        const { fileName, fileContent } = req.body;
        
        // Validate inputs
        if (!fileName || !fileContent || typeof fileContent !== 'string') {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid input: fileName and fileContent are required' 
            });
        }
        
        // Validate and sanitize file name
        const validatedFileName = validateFileName(fileName);
        if (!validatedFileName) {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid file name or unsupported file type' 
            });
        }
        
        // Check content length
        if (fileContent.length > 50000) { // 50KB limit
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'File content too large' 
            });
        }
        
        // Create temporary file with random name
        const randomId = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(validatedFileName);
        tempFileName = `/tmp/compile_${randomId}${ext}`;
        
        let result;
        
        if (ext === '.ts') {
            result = compileTypeScript(fileContent, tempFileName);
        } else if (ext === '.cpp') {
            result = compileCpp(fileContent, tempFileName);
        } else {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Unsupported file type' 
            });
        }
        
        res.json(result);
        
    } catch (error) {
        console.error('Compilation error:', error);
        res.status(500).json({ 
            hasError: true, 
            compilerError: 'Internal server error during compilation' 
        });
    } finally {
        // Clean up temporary file
        if (tempFileName) {
            try {
                fs.unlinkSync(tempFileName);
            } catch (error) {
                console.error('Failed to clean up temporary file:', error);
            }
        }
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

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        hasError: true, 
        compilerError: 'Endpoint not found' 
    });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Compiler feedback server running on 0.0.0.0:${PORT}`);
});