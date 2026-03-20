const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON bodies
app.use(express.json());

// POST /log endpoint
app.post('/log', (req, res) => {
    const { message } = req.body;
    
    // Append message to log file with newline
    fs.appendFile(LOG_FILE, message + '\n', (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
        }
        res.status(200).send();
    });
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist yet, return empty string
                return res.type('text/plain').status(200).send('');
            }
            console.error('Error reading log file:', err);
            return res.type('text/plain').status(200).send('');
        }
        res.type('text/plain').status(200).send(data);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});