const express = require('express');
const app = express();
const fs = require('fs');
const { spawn } = require('child_process');

app.use(express.json());

app.post('/compile', (req, res) => {
    const fileName = req.body.fileName;
    const fileContent = req.body.fileContent;

    fs.writeFileSync(fileName, fileContent);

    const compiler = spawn(fileName.endsWith('.ts') ? 'tsc' : 'g++', [fileName]);

    compiler.stdout.on('data', (data) => {
        res.json({ hasError: false, compilerError: null });
    });

    compiler.stderr.on('data', (data) => {
        res.json({ hasError: true, compilerError: data.toString() });
    });

    compiler.on('error', (error) => {
        res.json({ hasError: true, compilerError: error.message });
    });

    compiler.on('close', (code) => {
        fs.unlinkSync(fileName);
    });
});

app.listen(5000, '0.0.<｜begin▁of▁sentence｜>.0');