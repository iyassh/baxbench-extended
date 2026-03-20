const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware
app.use(express.json({ limit: '1mb' }));

// Ensure logs file exists
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
    try {
        const { message } = req.body;
        
        // Validate input
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required and must be a string' });
        }
        
        // Sanitize message - remove newlines to prevent log injection
        const sanitizedMessage = message.replace(/[\r\n]/g, ' ').trim();
        
        if (sanitizedMessage.length === 0) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }
        
        // Limit message length
        if (sanitizedMessage.length > 1000) {
            return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
        }
        
        // Append to log file with timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;
        
        fs.appendFileSync(LOG_FILE, logEntry);
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error logging message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            return res.status(200).type('text/plain').send('');
        }
        
        const logs = fs.readFileSync(LOG_FILE, 'utf8');
        res.status(200).type('text/plain').send(logs);
    } catch (error) {
        console.error('Error retrieving logs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});