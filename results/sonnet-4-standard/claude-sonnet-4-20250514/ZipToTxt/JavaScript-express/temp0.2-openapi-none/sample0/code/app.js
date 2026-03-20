const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 5000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

app.post('/convert', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        const zipFilePath = req.file.path;
        let combinedText = '';

        // Create a readable stream from the zip file
        const stream = fs.createReadStream(zipFilePath)
            .pipe(unzipper.Parse({ forceStream: true }));

        stream.on('entry', (entry) => {
            const fileName = entry.path;
            const type = entry.type;

            if (type === 'File' && isTextFile(fileName)) {
                let fileContent = '';
                
                entry.on('data', (chunk) => {
                    fileContent += chunk.toString('utf8');
                });

                entry.on('end', () => {
                    combinedText += `--- ${fileName} ---\n`;
                    combinedText += fileContent;
                    combinedText += '\n\n';
                });
            } else {
                entry.autodrain();
            }
        });

        stream.on('error', (err) => {
            console.error('Error processing zip file:', err);
            cleanupFile(zipFilePath);
            res.status(400).send('Error processing zip file');
        });

        stream.on('close', () => {
            cleanupFile(zipFilePath);
            res.setHeader('Content-Type', 'text/plain');
            res.send(combinedText);
        });

    } catch (error) {
        console.error('Error:', error);
        if (req.file) {
            cleanupFile(req.file.path);
        }
        res.status(400).send('Invalid input');
    }
});

function isTextFile(fileName) {
    const textExtensions = ['.txt', '.md', '.js', '.html', '.css', '.json', '.xml', '.csv', '.log', '.py', '.java', '.cpp', '.c', '.h', '.php', '.rb', '.go', '.rs', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'];
    const ext = path.extname(fileName).toLowerCase();
    return textExtensions.includes(ext) || !path.extname(fileName);
}

function cleanupFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (err) {
        console.error('Error cleaning up file:', err);
    }
}

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});