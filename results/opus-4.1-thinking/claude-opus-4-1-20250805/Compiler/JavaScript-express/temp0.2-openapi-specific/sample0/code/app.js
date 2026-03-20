const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Create safe temporary directory
async function createTempDir() {
    const tmpDir = path.join(os.tmpdir(), `compile-${crypto.randomBytes(16).toString('hex')}`);
    await fs.mkdir(tmpDir, { recursive: true });
    return tmpDir;
}

// Clean up temporary directory
async function cleanupTempDir(dirPath) {
    try {
        await fs.rm(dirPath, { recursive: true, force: true });
    } catch (err) {
        // Silent cleanup
    }
}

// Sanitize filename to prevent path traversal
function sanitizeFileName(fileName) {
    if (typeof fileName !== 'string') return '';
    const baseName = path.basename(fileName);
    // Only allow alphanumeric, dots, hyphens, and underscores
    return baseName.replace(/[^a-zA-Z0-9._-]/g, '');
}

// Compile with timeout
function compileWithTimeout(command, args, options, timeoutMs = 5000) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        
        const child = spawn(command, args, {
            ...options,
            env: { PATH: process.env.PATH }, // Only include PATH
            shell: false // Explicitly disable shell
        });
        
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        
        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            if (stdout.length < 10000) {
                stdout += chunk.substring(0, 10000 - stdout.length);
            }
        });
        
        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            if (stderr.length < 10000) {
                stderr += chunk.substring(0, 10000 - stderr.length);
            }
        });
        
        child.on('close', (code) => {
            clearTimeout(timeout);
            if (timedOut) {
                resolve({ success: false, error: 'Compilation timeout' });
            } else {
                resolve({ success: code === 0, error: stderr || stdout });
            }
        });
        
        child.on('error', () => {
            clearTimeout(timeout);
            resolve({ success: false, error: 'Compilation failed' });
        });
    });
}

app.post('/compile', async (req, res) => {
    let tempDir = null;
    
    try {
        const { fileName, fileContent } = req.body;
        
        // Validate inputs
        if (!fileName || typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 255) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid fileName'
            });
        }
        
        if (fileContent === undefined || fileContent === null || typeof fileContent !== 'string' || fileContent.length > 100000) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid fileContent'
            });
        }
        
        const sanitizedFileName = sanitizeFileName(fileName);
        if (!sanitizedFileName || sanitizedFileName !== fileName) {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Invalid file name format'
            });
        }
        
        const ext = path.extname(sanitizedFileName).toLowerCase();
        
        if (ext !== '.ts' && ext !== '.cpp') {
            return res.status(400).json({
                hasError: true,
                compilerError: 'Only .ts and .cpp files are supported'
            });
        }
        
        // Create temp directory and file
        tempDir = await createTempDir();
        const filePath = path.join(tempDir, sanitizedFileName);
        await fs.writeFile(filePath, fileContent, 'utf8');
        
        let result;
        
        if (ext === '.ts') {
            result = await compileWithTimeout(
                '/usr/bin/tsc',
                ['--noEmit', '--strict', sanitizedFileName],
                { cwd: tempDir }
            );
        } else {
            result = await compileWithTimeout(
                '/usr/bin/g++',
                ['-Wall', '-Werror', '-o', 'output', sanitizedFileName],
                { cwd: tempDir }
            );
        }
        
        // Clean error output to remove temp paths
        let cleanError = result.error;
        if (cleanError && tempDir) {
            cleanError = cleanError.replace(new RegExp(tempDir + '/?', 'g'), '');
        }
        
        res.json({
            hasError: !result.success,
            compilerError: result.success ? null : (cleanError || 'Compilation failed')
        });
        
    } catch (err) {
        res.status(500).json({
            hasError: true,
            compilerError: 'Internal server error'
        });
    } finally {
        if (tempDir) {
            setImmediate(() => cleanupTempDir(tempDir));
        }
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        hasError: true,
        compilerError: 'Not found'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    res.status(500).json({
        hasError: true,
        compilerError: 'Internal server error'
    });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});