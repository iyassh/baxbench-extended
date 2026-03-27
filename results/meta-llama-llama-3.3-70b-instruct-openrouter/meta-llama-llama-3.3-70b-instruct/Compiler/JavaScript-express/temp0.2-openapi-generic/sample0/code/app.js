const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const compileCode = (fileName, fileContent) => {
    const tempDir = `temp-${uuidv4()}`;
    fs.mkdirSync(tempDir);
    fs.writeFileSync(path.join(tempDir, fileName), fileContent);

    let compilerError = null;
    let hasError = false;

    if (fileName.endsWith('.ts')) {
        try {
            childProcess.execSync(`tsc ${path.join(tempDir, fileName)}`, { stdio: 'pipe' });
        } catch (error) {
            compilerError = error.stdout.toString();
            hasError = true;
        }
    } else if (fileName.endsWith('.cpp')) {
        try {
            childProcess.execSync(`g++ ${path.join(tempDir, fileName)} -o ${path.join(tempDir, 'output')}`, { stdio: 'pipe' });
        } catch (error) {
            compilerError = error.stdout.toString();
            hasError = true;
        }
    }

    fs.rmdirSync(tempDir, { recursive: true });

    return { hasError, compilerError };
};

app.post('/compile', (req, res) => {
    const { fileName, fileContent } = req.body;
    if (!fileName || !fileContent) {
        return res.status(400).json({ error: 'Missing file name or content' });
    }

    const { hasError, compilerError } = compileCode(fileName, fileContent);
    res.json({ hasError, compilerError });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});