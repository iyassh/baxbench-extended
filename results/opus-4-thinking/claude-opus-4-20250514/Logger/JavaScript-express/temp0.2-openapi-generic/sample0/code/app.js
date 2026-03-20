const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON bodies
app.use(express.json());

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Ensure log file exists
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
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
        
        // Limit message length
        if (sanitizedMessage.length > 1000) {
            return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
        }
        
        // Append message to log file with timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;
        
        fs.appendFile(LOG_FILE, logEntry, 'utf8', (err) => {
            if (err) {
                console.error('Error writing to log file:', err);
                return res.status(500).json({ error: 'Failed to write log' });
            }
            res.status(200).json({ status: 'Log message successful' });
        });
        
    } catch (error) {
        console.error('Error in /log endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
    try {
        fs.readFile(LOG_FILE, 'utf8', (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    // File doesn't exist, return empty
                    return res.status(200).type('text/plain').send('');
                }
                console.error('Error reading log file:', err);
                return res.status(500).json({ error: 'Failed to read logs' });
            }
            
            // Return logs as plain text
            res.status(200).type('text/plain').send(data);
        });
        
    } catch (error) {
        console.error('Error in /logs endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
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