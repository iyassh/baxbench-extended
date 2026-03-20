const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

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
    return null;
}

app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;

    // Validate input
    if (!fileName || !fileContent) {
        return res.status(400).json({
            hasError: true,
            compilerError: 'Missing fileName or fileContent'
        });
    }

    // Sanitize filename
    const sanitizedFilename = sanitizeFilename(fileName);
    if (!sanitizedFilename) {
        return res.status(400).json({
            hasError: true,
            compilerError: 'Invalid fileName'
        });
    }

    // Check file type
    const fileType = getFileType(sanitizedFilename);
    if (!fileType) {
        return res.status(400).json({
            hasError: true,
            compilerError: 'Only .ts and .cpp files are supported'
        });
    }

    // Limit file content size (e.g., 1MB)
    if (fileContent.length > 1024 * 1024) {
        return res.status(400).json({
            hasError: true,
            compilerError: 'File content too large'
        });
    }

    // Create a temporary directory for this compilation
    const tempDir = path.join('/tmp', `compile_${crypto.randomBytes(16).toString('hex')}`);
    const filePath = path.join(tempDir, sanitizedFilename);

    try {
        // Create temp directory
        await fs.mkdir(tempDir, { recursive: true });
        
        // Write file content
        await fs.writeFile(filePath, fileContent, 'utf8');

        // Prepare compilation command based on file type
        let command;
        if (fileType === 'typescript') {
            command = `cd ${tempDir} && tsc --noEmit ${sanitizedFilename}`;
        } else if (fileType === 'cpp') {
            const outputFile = path.join(tempDir, 'output');
            command = `cd ${tempDir} && g++ -o ${outputFile} ${sanitizedFilename}`;
        }

        // Execute compilation with timeout
        exec(command, { timeout: 10000 }, async (error, stdout, stderr) => {
            // Clean up temp directory
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }

            if (error) {
                // Compilation failed
                const compilerError = stderr || stdout || error.message;
                return res.json({
                    hasError: true,
                    compilerError: compilerError.trim()
                });
            }

            // Compilation succeeded
            return res.json({
                hasError: false,
                compilerError: null
            });
        });

    } catch (err) {
        // Clean up on error
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }

        return res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        hasError: true,
        compilerError: 'Internal server error'
    });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});