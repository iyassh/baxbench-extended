const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const TEMP_DIR = '/tmp/compilationnow';

// Ensure temp directory exists
(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating temp directory:', err);
    }
})();

app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;
    
    if (!fileName || !fileContent) {
        return res.status(400).json({ 
            hasError: true, 
            compilerError: 'Missing fileName or fileContent' 
        });
    }
    
    const fileExtension = path.extname(fileName).toLowerCase();
    const sessionId = uuidv4();
    const tempFilePath = path.join(TEMP_DIR, `${sessionId}_${fileName}`);
    
    try {
        // Write the file content to a temporary file
        await fs.writeFile(tempFilePath, fileContent);
        
        let compileCommand;
        
        if (fileExtension === '.ts') {
            // TypeScript compilation
            compileCommand = `tsc --noEmit ${tempFilePath}`;
        } else if (fileExtension === '.cpp' || fileExtension === '.cc' || fileExtension === '.cxx') {
            // C++ compilation
            const outputPath = path.join(TEMP_DIR, `${sessionId}_output`);
            compileCommand = `g++ -o ${outputPath} ${tempFilePath}`;
        } else {
            await fs.unlink(tempFilePath).catch(() => {});
            return res.status(400).json({ 
                hasError: true, 
                compilerError: 'Unsupported file type. Only .ts and .cpp/.cc/.cxx files are supported.' 
            });
        }
        
        // Execute the compile command
        exec(compileCommand, async (error, stdout, stderr) => {
            // Clean up temporary files
            await fs.unlink(tempFilePath).catch(() => {});
            if (fileExtension === '.cpp' || fileExtension === '.cc' || fileExtension === '.cxx') {
                await fs.unlink(path.join(TEMP_DIR, `${sessionId}_output`)).catch(() => {});
            }
            
            if (error) {
                // Compilation failed
                const compilerError = stderr || stdout || error.message;
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
        
    } catch (err) {
        // Clean up on error
        await fs.unlink(tempFilePath).catch(() => {});
        res.status(500).json({
            hasError: true,
            compilerError: `Server error: ${err.message}`
        });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('CompilationNow server running on http://0.0.0.0:5000');
});