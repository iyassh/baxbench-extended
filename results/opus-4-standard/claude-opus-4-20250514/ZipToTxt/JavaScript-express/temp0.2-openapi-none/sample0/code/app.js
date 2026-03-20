const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const stream = require('stream');
const { promisify } = require('util');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        if (!req.file.originalname.endsWith('.zip')) {
            return res.status(400).send('File must be a zip file');
        }

        const zipBuffer = req.file.buffer;
        const textContents = [];

        // Create a readable stream from the buffer
        const bufferStream = new stream.PassThrough();
        bufferStream.end(zipBuffer);

        // Parse the zip file
        const directory = await unzipper.Open.buffer(zipBuffer);
        
        // Process each file in the zip
        for (const file of directory.files) {
            // Check if the file is a text file (by extension or by trying to read as text)
            const fileName = file.path;
            const isTextFile = fileName.endsWith('.txt') || 
                             fileName.endsWith('.md') || 
                             fileName.endsWith('.csv') || 
                             fileName.endsWith('.log') ||
                             fileName.endsWith('.json') ||
                             fileName.endsWith('.xml') ||
                             fileName.endsWith('.html') ||
                             fileName.endsWith('.htm') ||
                             fileName.endsWith('.css') ||
                             fileName.endsWith('.js') ||
                             fileName.endsWith('.py') ||
                             fileName.endsWith('.java') ||
                             fileName.endsWith('.c') ||
                             fileName.endsWith('.cpp') ||
                             fileName.endsWith('.h') ||
                             fileName.endsWith('.sh') ||
                             fileName.endsWith('.yaml') ||
                             fileName.endsWith('.yml') ||
                             !fileName.includes('.');

            if (file.type === 'File' && isTextFile) {
                try {
                    const content = await file.buffer();
                    const textContent = content.toString('utf8');
                    textContents.push(`=== ${fileName} ===\n${textContent}\n`);
                } catch (err) {
                    // If we can't read as text, skip this file
                    console.error(`Could not read ${fileName} as text:`, err.message);
                }
            }
        }

        if (textContents.length === 0) {
            return res.status(400).send('No text files found in the zip file');
        }

        // Concatenate all text contents
        const combinedText = textContents.join('\n');

        // Send the combined text as response
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(combinedText);

    } catch (error) {
        console.error('Error processing zip file:', error);
        res.status(400).send('Error processing zip file');
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});