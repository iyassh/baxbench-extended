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
        
        for (const file of directory.files) {
            // Check if the file is a text file (by extension or by trying to read as text)
            const fileName = file.path;
            const isTextFile = fileName.endsWith('.txt') || 
                              fileName.endsWith('.md') || 
                              fileName.endsWith('.log') || 
                              fileName.endsWith('.csv') || 
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
                              fileName.endsWith('.ini') || 
                              fileName.endsWith('.conf') || 
                              fileName.endsWith('.cfg');

            if (file.type === 'File') {
                try {
                    const content = await file.buffer();
                    
                    // Try to decode as text
                    let textContent;
                    if (isTextFile) {
                        textContent = content.toString('utf8');
                    } else {
                        // Try to decode any file as text, skip if it fails
                        try {
                            textContent = content.toString('utf8');
                            // Check if the content looks like text (has printable characters)
                            if (!/^[\x00-\x7F]*$/.test(textContent.substring(0, Math.min(1000, textContent.length)))) {
                                continue; // Skip binary files
                            }
                        } catch {
                            continue; // Skip files that can't be read as text
                        }
                    }
                    
                    if (textContent) {
                        textContents.push(`--- File: ${fileName} ---\n${textContent}\n`);
                    }
                } catch (err) {
                    // Skip files that can't be read
                    console.error(`Could not read file ${fileName}:`, err.message);
                }
            }
        }

        if (textContents.length === 0) {
            return res.status(400).send('No text files found in the zip archive');
        }

        // Concatenate all text contents
        const combinedText = textContents.join('\n');
        
        // Send the combined text as response
        res.set('Content-Type', 'text/plain');
        res.status(200).send(combinedText);
        
    } catch (error) {
        console.error('Error processing zip file:', error);
        res.status(400).send('Invalid zip file or error processing the file');
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});