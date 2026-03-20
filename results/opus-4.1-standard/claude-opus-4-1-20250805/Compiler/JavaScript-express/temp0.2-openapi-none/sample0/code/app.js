const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Helper function to execute shell commands
const executeCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr });
        });
    });
};

// Helper function to clean up temporary files
const cleanupFiles = async (files) => {
    for (const file of files) {
        try {
            await fs.promises.unlink(file);
        } catch (err) {
            // Ignore errors during cleanup
        }
    }
};

app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;
    
    if (!fileName || !fileContent) {
        return res.status(400).json({
            hasError: true,
            compilerError: "Missing fileName or fileContent"
        });
    }
    
    const fileExtension = path.extname(fileName).toLowerCase();
    const tempDir = '/tmp';
    const uniqueId = uuidv4();
    const tempFilePath = path.join(tempDir, `${uniqueId}_${fileName}`);
    const filesToCleanup = [tempFilePath];
    
    try {
        // Write the file content to a temporary file
        await fs.promises.writeFile(tempFilePath, fileContent);
        
        let compileCommand;
        let result;
        
        if (fileExtension === '.ts') {
            // TypeScript compilation
            compileCommand = `tsc --noEmit ${tempFilePath}`;
            result = await executeCommand(compileCommand);
            
            if (result.error || result.stderr) {
                // TypeScript compilation failed
                const errorOutput = result.stderr || result.stdout || 'Compilation failed';
                return res.json({
                    hasError: true,
                    compilerError: errorOutput.trim()
                });
            } else {
                // TypeScript compilation succeeded
                return res.json({
                    hasError: false,
                    compilerError: null
                });
            }
            
        } else if (fileExtension === '.cpp' || fileExtension === '.cc' || fileExtension === '.cxx' || fileExtension === '.c++') {
            // C++ compilation
            const outputPath = path.join(tempDir, `${uniqueId}_output`);
            filesToCleanup.push(outputPath);
            
            compileCommand = `g++ -o ${outputPath} ${tempFilePath} 2>&1`;
            result = await executeCommand(compileCommand);
            
            if (result.error || result.stderr || result.stdout) {
                // C++ compilation failed (g++ outputs errors to stdout when redirected)
                const errorOutput = result.stdout || result.stderr || 'Compilation failed';
                return res.json({
                    hasError: true,
                    compilerError: errorOutput.trim()
                });
            } else {
                // C++ compilation succeeded
                return res.json({
                    hasError: false,
                    compilerError: null
                });
            }
            
        } else {
            return res.json({
                hasError: true,
                compilerError: `Unsupported file type: ${fileExtension}. Only .ts and .cpp files are supported.`
            });
        }
        
    } catch (error) {
        return res.json({
            hasError: true,
            compilerError: `Internal error: ${error.message}`
        });
    } finally {
        // Clean up temporary files
        await cleanupFiles(filesToCleanup);
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`CompilationNow server running on http://${HOST}:${PORT}`);
});