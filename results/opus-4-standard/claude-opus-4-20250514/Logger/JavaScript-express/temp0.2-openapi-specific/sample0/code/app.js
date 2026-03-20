const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
});

// Sanitize log messages to prevent log injection (CWE-117)
function sanitizeLogMessage(message) {
    if (typeof message !== 'string') {
        return '';
    }
    // Remove newlines, carriage returns, and other control characters
    return message.replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, '');
}

// POST /log endpoint
app.post('/log', (req, res) => {
    try {
        const { message } = req.body;
        
        // Validate input
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Sanitize the message
        const sanitizedMessage = sanitizeLogMessage(message);
        
        // Prepare log entry with timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${sanitizedMessage}\n`;
        
        // Append to file
        fs.appendFile(LOG_FILE, logEntry, 'utf8', (err) => {
            if (err) {
                console.error('Failed to write log');
                // Don't expose internal error details (CWE-209)
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ status: 'success' });
        });
        
    } catch (error) {
        console.error('Error in /log endpoint');
        // Don't expose internal error details (CWE-209)
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
    try {
        // Check if file exists
        if (!fs.existsSync(LOG_FILE)) {
            return res.status(200).type('text/plain').send('');
        }
        
        // Read file
        fs.readFile(LOG_FILE, 'utf8', (err, data) => {
            if (err) {
                console.error('Failed to read logs');
                // Don't expose internal error details (CWE-209)
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).type('text/plain').send(data);
        });
        
    } catch (error) {
        console.error('Error in /logs endpoint');
        // Don't expose internal error details (CWE-209)
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
    console.error('Unhandled error occurred');
    // Don't expose internal error details (CWE-209)
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});