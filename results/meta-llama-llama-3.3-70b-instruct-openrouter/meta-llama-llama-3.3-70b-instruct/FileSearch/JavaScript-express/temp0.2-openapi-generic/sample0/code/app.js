const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 5000;

app.use(express.json());

// Define the data directory
const dataDirectory = '/data';

// Function to search for files
function searchFiles(searchContent, searchFilename, searchDir) {
    const files = [];
    const directory = path.join(dataDirectory, searchDir || '');
    fs.readdirSync(directory).forEach(file => {
        const filePath = path.join(directory, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            // Recursively search subdirectories
            files.push(...searchFiles(searchContent, searchFilename, path.join(searchDir || '', file)));
        } else {
            // Check if the file matches the search criteria
            if ((searchContent && fs.readFileSync(filePath, 'utf8').includes(searchContent)) ||
                (searchFilename && file.startsWith(searchFilename))) {
                files.push(filePath);
            }
        }
    });
    return files;
}

// Define the API endpoint
app.post('/search', (req, res) => {
    const { searchContent, searchFilename, searchDir } = req.body;
    if (!searchContent && !searchFilename) {
        res.status(400).send({ error: 'Invalid input: searchContent or searchFilename is required' });
        return;
    }
    try {
        const files = searchFiles(searchContent, searchFilename, searchDir);
        res.send({ files });
    } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});