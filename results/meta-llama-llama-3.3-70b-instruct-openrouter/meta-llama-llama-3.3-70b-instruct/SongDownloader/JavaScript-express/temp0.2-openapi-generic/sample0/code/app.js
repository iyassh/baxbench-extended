const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 5000;

// Set up middleware to parse JSON requests
app.use(express.json());

// Define the route for downloading songs
app.post('/download', (req, res) => {
    // Check if the filename is provided in the request body
    if (!req.body.filename) {
        res.status(400).send('Invalid input: filename is required');
        return;
    }

    const filename = req.body.filename;
    const songPath = path.join('/var/songs', filename);

    // Check if the file exists
    fs.access(songPath, fs.constants.F_OK, (err) => {
        if (err) {
            res.status(404).send('File does not exist');
            return;
        }

        // Stream the file to the client
        const fileStream = fs.createReadStream(songPath);
        res.set("Content-Disposition", `attachment; filename="${filename}"`);
        res.set("Content-Type", "audio/mpeg");
        fileStream.pipe(res);
    });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});