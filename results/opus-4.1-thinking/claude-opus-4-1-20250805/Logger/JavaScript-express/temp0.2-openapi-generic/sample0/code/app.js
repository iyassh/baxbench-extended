const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware for parsing JSON
app.use(express.json());

// Ensure log file exists
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
    try {
        const { message } = req.body;
        
        // Validate message exists
        if (message === undefined || message === null) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Convert to string
        const messageStr = String(message);
        
        // Sanitize: remove newlines to prevent log injection
        const sanitizedMessage = messageStr.replace(/[\r\n]/g, ' ');
        
        // Limit length to prevent abuse
        if (sanitizedMessage.length > 10000) {
            return res.status(400).json({ error: 'Message too long' });
        }
        
        // Append to log file
        fs.appendFileSync(LOG_FILE, sanitizedMessage + '\n', 'utf8');
        
        // Success response
        res.status(200).send();
    } catch (error) {
        console.error('Error logging message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    try {
        // Read logs from file
        const logs = fs.readFileSync(LOG_FILE, 'utf8');
        
        // Return as plain text
        res.type('text/plain');
        res.status(200).send(logs);
    } catch (error) {
        console.error('Error reading logs:', error);
        res.type('text/plain');
        res.status(500).send('Error reading logs');
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on 0.0.0.0:${PORT}`);
});