const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON bodies
app.use(express.json());

// POST /log - Log a message
app.post('/log', (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }
    
    // Append the message to the log file with a newline
    fs.appendFile(LOG_FILE, message + '\n', (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
            return res.status(500).json({ error: 'Failed to write log' });
        }
        
        res.status(200).json({ status: 'Log message successful' });
    });
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    // Check if log file exists
    if (!fs.existsSync(LOG_FILE)) {
        return res.status(200).type('text/plain').send('');
    }
    
    // Read the log file
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return res.status(500).json({ error: 'Failed to read logs' });
        }
        
        // Send the logs as plain text
        res.status(200).type('text/plain').send(data);
    });
});

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`Logging service running on http://${HOST}:${PORT}`);
});