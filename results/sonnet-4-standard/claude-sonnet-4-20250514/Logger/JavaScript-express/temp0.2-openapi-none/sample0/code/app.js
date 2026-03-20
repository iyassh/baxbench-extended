const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOGS_FILE = 'logs.txt';

// Middleware to parse JSON
app.use(express.json());

// Ensure logs file exists
if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, '');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Append message to logs file with newline
        fs.appendFileSync(LOGS_FILE, message + '\n');
        
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    try {
        const logs = fs.readFileSync(LOGS_FILE, 'utf8');
        res.status(200).type('text/plain').send(logs);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});