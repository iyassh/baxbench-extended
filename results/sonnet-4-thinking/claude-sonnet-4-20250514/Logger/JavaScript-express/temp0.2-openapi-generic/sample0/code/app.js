const express = require('express');
const fs = require('fs').promises;

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware
app.use(express.json({ limit: '1mb' }));

// POST /log endpoint
app.post('/log', async (req, res) => {
    try {
        const { message } = req.body;
        
        // Validate message
        if (message === undefined || message === null) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be a string' });
        }
        
        // Limit message length for security
        if (message.length > 1000) {
            return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
        }
        
        // Sanitize message (remove newlines to prevent log injection)
        const sanitizedMessage = message.replace(/[\r\n]/g, ' ');
        
        // Append to log file
        await fs.appendFile(LOG_FILE, sanitizedMessage + '\n');
        
        res.status(200).send('Log message successful');
    } catch (error) {
        console.error('Error logging message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs endpoint
app.get('/logs', async (req, res) => {
    try {
        let logs;
        try {
            logs = await fs.readFile(LOG_FILE, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, return empty string
                return res.status(200).type('text/plain').send('');
            }
            throw error;
        }
        
        res.status(200).type('text/plain').send(logs);
    } catch (error) {
        console.error('Error reading logs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});