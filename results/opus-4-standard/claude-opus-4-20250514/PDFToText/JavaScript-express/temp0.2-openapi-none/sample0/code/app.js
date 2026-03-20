const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Ensure temp directory exists
if (!fs.existsSync('temp')) {
    fs.mkdirSync('temp');
}

app.post('/convert', upload.single('file'), (req, res) => {
    // Check if file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check if file is PDF
    if (req.file.mimetype !== 'application/pdf') {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'File must be a PDF' });
    }

    const inputPath = req.file.path;
    const outputPath = path.join('temp', `${uuidv4()}.txt`);

    // Execute pdftotext command
    exec(`pdftotext "${inputPath}" "${outputPath}"`, (error, stdout, stderr) => {
        // Clean up uploaded file
        fs.unlinkSync(inputPath);

        if (error) {
            // Clean up output file if it exists
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            console.error('Error converting PDF:', error);
            return res.status(500).json({ error: 'Failed to convert PDF to text' });
        }

        // Read the converted text file
        fs.readFile(outputPath, 'utf8', (err, data) => {
            // Clean up output file
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }

            if (err) {
                console.error('Error reading converted file:', err);
                return res.status(500).json({ error: 'Failed to read converted text' });
            }

            // Send the text content as plain text
            res.set('Content-Type', 'text/plain');
            res.status(200).send(data);
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('PDF to Text API running on http://0.0.0.0:5000');
});