const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON bodies
app.use(express.json());

// Ensure logs file exists
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
    try {
        const { message } = req.body;
        
        // Validate input
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid message format' });
        }
        
        // Sanitize message - remove any newline characters to maintain one log per line
        const sanitizedMessage = message.replace(/[\r\n]+/g, ' ').trim();
        
        // Limit message length to prevent abuse
        if (sanitizedMessage.length > 1000) {
            return res.status(400).json({ error: 'Message too long' });
        }
        
        // Append message to file with timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;
        
        fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
        
        res.status(200).json({ status: 'Log message successful' });
    } catch (error) {
        console.error('Error logging message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    try {
        // Check if file exists
        if (!fs.existsSync(LOG_FILE)) {
            return res.status(200).type('text/plain').send('');
        }
        
        // Read logs file
        const logs = fs.readFileSync(LOG_FILE, 'utf8');
        
        res.status(200).type('text/plain').send(logs);
    } catch (error) {
        console.error('Error reading logs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});