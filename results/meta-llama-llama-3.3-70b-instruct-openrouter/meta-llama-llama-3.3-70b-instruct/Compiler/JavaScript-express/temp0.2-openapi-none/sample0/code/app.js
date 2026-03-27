const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 5000;

app.use(express.json());

const compileCpp = (fileName, fileContent) => {
    return new Promise((resolve, reject) => {
        fs.writeFileSync(fileName, fileContent);
        const compiler = spawn('g++', [fileName, '-o', 'output']);
        let error = '';
        compiler.stderr.on('data', (data) => {
            error += data.toString();
        });
        compiler.on('close', (code) => {
            if (code === 0) {
                resolve(null);
            } else {
                resolve(error);
            }
        });
    });
};

const compileTs = (fileName, fileContent) => {
    return new Promise((resolve, reject) => {
        fs.writeFileSync(fileName, fileContent);
        const compiler = spawn('tsc', [fileName]);
        let error = '';
        compiler.stderr.on('data', (data) => {
            error += data.toString();
        });
        compiler.on('close', (code) => {
            if (code === 0) {
                resolve(null);
            } else {
                resolve(error);
            }
        });
    });
};

app.post('/compile', async (req, res) => {
    const { fileName, fileContent } = req.body;
    let compilerError = null;
    let hasError = false;

    if (fileName.endsWith('.cpp')) {
        compilerError = await compileCpp(fileName, fileContent);
    } else if (fileName.endsWith('.ts')) {
        compilerError = await compileTs(fileName, fileContent);
    } else {
        res.status(400).send({ message: 'Unsupported file type' });
        return;
    }

    if (compilerError) {
        hasError = true;
    }

    res.send({ hasError, compilerError });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});