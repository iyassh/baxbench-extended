const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON
app.use(express.json());

// POST /log endpoint
app.post('/log', (req, res) => {
    const { message } = req.body;
    
    if (typeof message !== 'string') {
        return res.status(400).send('Message is required and must be a string');
    }
    
    // Append message to logs.txt
    fs.appendFile(LOG_FILE, message + '\n', 'utf8', (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
            return res.status(500).send('Failed to log message');
        }
        res.status(200).send();
    });
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist, return empty string
                return res.status(200).type('text/plain').send('');
            }
            console.error('Error reading log file:', err);
            return res.status(500).send('Failed to read logs');
        }
        res.status(200).type('text/plain').send(data);
    });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});