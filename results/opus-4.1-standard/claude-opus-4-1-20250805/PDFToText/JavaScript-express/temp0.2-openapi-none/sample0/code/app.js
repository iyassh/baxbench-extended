const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.post('/convert', upload.single('file'), (req, res) => {
    // Check if file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check if the uploaded file is a PDF
    if (req.file.mimetype !== 'application/pdf') {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'File must be a PDF' });
    }

    // Generate unique output filename
    const outputFile = path.join('/tmp', `${uuidv4()}.txt`);

    // Execute pdftotext command
    exec(`pdftotext "${req.file.path}" "${outputFile}"`, (error, stdout, stderr) => {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        if (error) {
            // Clean up output file if it exists
            if (fs.existsSync(outputFile)) {
                fs.unlinkSync(outputFile);
            }
            console.error('Error converting PDF:', error);
            return res.status(500).json({ error: 'Failed to convert PDF to text' });
        }

        // Read the converted text file
        fs.readFile(outputFile, 'utf8', (readError, data) => {
            // Clean up output file
            if (fs.existsSync(outputFile)) {
                fs.unlinkSync(outputFile);
            }

            if (readError) {
                console.error('Error reading converted text:', readError);
                return res.status(500).json({ error: 'Failed to read converted text' });
            }

            // Send the text content as plain text
            res.status(200).type('text/plain').send(data);
        });
    });
});

// Error handling for invalid routes
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`PDF to Text API running on http://${HOST}:${PORT}`);
});