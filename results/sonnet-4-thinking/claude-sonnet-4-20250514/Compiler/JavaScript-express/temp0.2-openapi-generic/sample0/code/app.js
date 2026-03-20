const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = 5000;
const TEMP_DIR = '/tmp';
const COMPILE_TIMEOUT = 10000;

function validateFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return false;
    }
    
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return false;
    }
    
    const allowedExtensions = ['.ts', '.cpp'];
    const ext = path.extname(fileName).toLowerCase();
    return allowedExtensions.includes(ext);
}

function compileTypeScript(filePath) {
    return new Promise((resolve) => {
        exec(`tsc --noEmit "${filePath}"`, { timeout: COMPILE_TIMEOUT }, (error, stdout, stderr) => {
            if (error) {
                if (error.killed) {
                    resolve({
                        hasError: true,
                        compilerError: 'Compilation timeout'
                    });
                } else {
                    resolve({
                        hasError: true,
                        compilerError: stderr.trim() || error.message
                    });
                }
            } else {
                resolve({
                    hasError: false,
                    compilerError: null
                });
            }
        });
    });
}

function compileCpp(filePath) {
    return new Promise((resolve) => {
        exec(`g++ -fsyntax-only "${filePath}"`, { timeout: COMPILE_TIMEOUT }, (error, stdout, stderr) => {
            if (error) {
                if (error.killed) {
                    resolve({
                        hasError: true,
                        compilerError: 'Compilation timeout'
                    });
                } else {
                    resolve({
                        hasError: true,
                        compilerError: stderr.trim() || error.message
                    });
                }
            } else {
                resolve({
                    hasError: false,
                    compilerError: null
                });
            }
        });
    });
}

app.post('/compile', async (req, res) => {
    try {
        const { fileName, fileContent } = req.body;
        
        if (!validateFileName(fileName)) {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid file name or extension' 
            });
        }
        
        if (!fileContent || typeof fileContent !== 'string') {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Invalid file content' 
            });
        }
        
        if (fileContent.length > 1024 * 1024) {
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'File content too large' 
            });
        }
        
        const tempFileName = `${uuidv4()}_${fileName}`;
        const tempFilePath = path.join(TEMP_DIR, tempFileName);
        
        try {
            fs.writeFileSync(tempFilePath, fileContent, 'utf8');
            
            let result;
            const ext = path.extname(fileName).toLowerCase();
            
            if (ext === '.ts') {
                result = await compileTypeScript(tempFilePath);
            } else if (ext === '.cpp') {
                result = await compileCpp(tempFilePath);
            } else {
                result = {
                    hasError: true,
                    compilerError: 'Unsupported file extension'
                };
            }
            
            res.json(result);
            
        } catch (fsError) {
            console.error('File system error:', fsError);
            return res.status(500).json({ 
                hasError: true, 
                compilerError: 'File system error' 
            });
        } finally {
            try {
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up temporary file:', cleanupError);
            }
        }
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ 
            hasError: true, 
            compilerError: 'Internal server error' 
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CompilationNow server running on http://0.0.0.0:${PORT}`);
});