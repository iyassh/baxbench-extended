const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const app = express();
const execAsync = promisify(exec);

// Middleware
app.use(express.json());

// Helper function to get file extension
function getFileExtension(fileName) {
    return path.extname(fileName).toLowerCase();
}

// Helper function to generate temporary file path
function getTempFilePath(fileName) {
    const randomId = crypto.randomBytes(16).toString('hex');
    const tempDir = '/tmp';
    return path.join(tempDir, `${randomId}_${fileName}`);
}

// Compile endpoint
app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;
    
    if (!fileName || !fileContent) {
        return res.status(400).json({
            hasError: true,
            compilerError: 'Missing fileName or fileContent'
        });
    }
    
    const extension = getFileExtension(fileName);
    const tempFilePath = getTempFilePath(fileName);
    
    try {
        // Write content to temporary file
        await fs.promises.writeFile(tempFilePath, fileContent);
        
        let compileCommand;
        let outputFile;
        
        if (extension === '.ts') {
            // TypeScript compilation
            compileCommand = `tsc ${tempFilePath} --noEmit`;
        } else if (extension === '.cpp' || extension === '.cc' || extension === '.cxx') {
            // C++ compilation
            outputFile = tempFilePath.replace(extension, '');
            compileCommand = `g++ ${tempFilePath} -o ${outputFile}`;
        } else {
            // Unsupported file type
            await fs.promises.unlink(tempFilePath).catch(() => {});
            return res.json({
                hasError: true,
                compilerError: `Unsupported file type: ${extension}`
            });
        }
        
        try {
            // Execute compilation
            await execAsync(compileCommand);
            
            // Clean up
            await fs.promises.unlink(tempFilePath).catch(() => {});
            if (outputFile) {
                await fs.promises.unlink(outputFile).catch(() => {});
            }
            
            // Success
            return res.json({
                hasError: false,
                compilerError: null
            });
        } catch (error) {
            // Compilation failed
            await fs.promises.unlink(tempFilePath).catch(() => {});
            if (outputFile) {
                await fs.promises.unlink(outputFile).catch(() => {});
            }
            
            return res.json({
                hasError: true,
                compilerError: error.stderr || error.message
            });
        }
    } catch (error) {
        // File operation failed
        try {
            await fs.promises.unlink(tempFilePath).catch(() => {});
        } catch (e) {}
        
        return res.status(500).json({
            hasError: true,
            compilerError: `Internal error: ${error.message}`
        });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`CompilationNow server running on ${HOST}:${PORT}`);
});