const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOGS_FILE = 'logs.txt';

// Middleware to parse JSON bodies
app.use(express.json());

// POST /log - Log a message
app.post('/log', (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }
    
    // Append message to logs.txt file with a newline
    fs.appendFile(LOGS_FILE, message + '\n', (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
            return res.status(500).json({ error: 'Failed to log message' });
        }
        res.status(200).json({ status: 'Log message successful' });
    });
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    // Check if file exists
    if (!fs.existsSync(LOGS_FILE)) {
        return res.status(200).type('text/plain').send('');
    }
    
    // Read logs from file
    fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return res.status(500).json({ error: 'Failed to retrieve logs' });
        }
        res.status(200).type('text/plain').send(data);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service is running on http://0.0.0.0:${PORT}`);
});