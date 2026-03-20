const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);

const app = express();
app.use(express.json());

// Validate fileName to prevent path traversal and command injection
function isValidFileName(fileName) {
    // Check for path traversal attempts
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return false;
    }
    // Only allow alphanumeric characters, dots, dashes, and underscores
    return /^[a-zA-Z0-9._-]+$/.test(fileName);
}

// POST /compile endpoint
app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;
    
    if (!fileName || fileContent === undefined) {
        return res.status(400).json({
            hasError: true,
            compilerError: "fileName and fileContent are required"
        });
    }
    
    // Validate fileName
    if (!isValidFileName(fileName)) {
        return res.status(400).json({
            hasError: true,
            compilerError: "Invalid fileName. Only alphanumeric characters, dots, dashes, and underscores are allowed."
        });
    }
    
    // Create a unique temporary directory for this compilation
    const sessionDir = path.join(os.tmpdir(), 'compilation-' + uuidv4());
    fs.mkdirSync(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, fileName);
    
    try {
        // Write the content to a temporary file
        fs.writeFileSync(filePath, fileContent);
        
        let result;
        
        // Determine the file type and compile accordingly
        if (fileName.endsWith('.ts')) {
            // Compile TypeScript
            try {
                await execAsync(`tsc --noEmit "${filePath}"`);
                result = { hasError: false, compilerError: null };
            } catch (error) {
                result = { 
                    hasError: true, 
                    compilerError: error.stderr || error.message 
                };
            }
        } else if (fileName.endsWith('.cpp') || fileName.endsWith('.cc') || fileName.endsWith('.cxx')) {
            // Compile C++
            const outputPath = filePath.replace(/\.(cpp|cc|cxx)$/, '.out');
            try {
                await execAsync(`g++ "${filePath}" -o "${outputPath}"`);
                result = { hasError: false, compilerError: null };
            } catch (error) {
                result = { 
                    hasError: true, 
                    compilerError: error.stderr || error.message 
                };
            }
        } else {
            result = {
                hasError: true,
                compilerError: "Unsupported file type. Only TypeScript (.ts) and C++ (.cpp, .cc, .cxx) files are supported."
            };
        }
        
        // Send the response
        res.json(result);
        
    } catch (error) {
        res.json({
            hasError: true,
            compilerError: error.message
        });
    } finally {
        // Clean up the temporary directory
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
            console.error('Error cleaning up session directory:', error);
        }
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`CompilationNow server running at http://${HOST}:${PORT}`);
});