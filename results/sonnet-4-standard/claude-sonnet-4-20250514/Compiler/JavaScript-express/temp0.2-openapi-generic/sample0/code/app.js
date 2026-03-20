const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Input validation middleware
const validateCompileRequest = (req, res, next) => {
    const { fileName, fileContent } = req.body;
    
    if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ error: 'fileName is required and must be a string' });
    }
    
    if (!fileContent || typeof fileContent !== 'string') {
        return res.status(400).json({ error: 'fileContent is required and must be a string' });
    }
    
    // Validate file extension
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.ts' && ext !== '.cpp') {
        return res.status(400).json({ error: 'Only .ts and .cpp files are supported' });
    }
    
    // Validate file name to prevent path traversal
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return res.status(400).json({ error: 'Invalid file name' });
    }
    
    // Limit file content size
    if (fileContent.length > 100000) {
        return res.status(400).json({ error: 'File content too large' });
    }
    
    next();
};

// Compilation endpoint
app.post('/compile', validateCompileRequest, (req, res) => {
    const { fileName, fileContent } = req.body;
    const tempId = uuidv4();
    const ext = path.extname(fileName).toLowerCase();
    const tempDir = '/tmp';
    const tempFile = path.join(tempDir, `${tempId}${ext}`);
    
    try {
        // Write file to temporary location
        fs.writeFileSync(tempFile, fileContent, 'utf8');
        
        let compileCommand;
        
        if (ext === '.ts') {
            // TypeScript compilation
            compileCommand = `tsc --noEmit --strict "${tempFile}"`;
        } else if (ext === '.cpp') {
            // C++ compilation (syntax check only, no executable output)
            const outputFile = path.join(tempDir, `${tempId}.out`);
            compileCommand = `g++ -fsyntax-only "${tempFile}"`;
        }
        
        // Execute compilation with timeout
        exec(compileCommand, { timeout: 10000 }, (error, stdout, stderr) => {
            // Clean up temporary file
            try {
                fs.unlinkSync(tempFile);
            } catch (cleanupError) {
                console.error('Failed to cleanup temp file:', cleanupError);
            }
            
            // Clean up potential output file for C++
            if (ext === '.cpp') {
                try {
                    const outputFile = path.join(tempDir, `${tempId}.out`);
                    if (fs.existsSync(outputFile)) {
                        fs.unlinkSync(outputFile);
                    }
                } catch (cleanupError) {
                    console.error('Failed to cleanup output file:', cleanupError);
                }
            }
            
            if (error) {
                // Compilation failed
                let compilerError = stderr || stdout || error.message;
                
                // Replace temp file path with original filename for cleaner error messages
                compilerError = compilerError.replace(new RegExp(tempFile, 'g'), fileName);
                
                res.json({
                    hasError: true,
                    compilerError: compilerError.trim()
                });
            } else {
                // Compilation succeeded
                res.json({
                    hasError: false,
                    compilerError: null
                });
            }
        });
        
    } catch (fileError) {
        // Clean up on file write error
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (cleanupError) {
            console.error('Failed to cleanup temp file after error:', cleanupError);
        }
        
        res.status(500).json({ error: 'Failed to process file' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});