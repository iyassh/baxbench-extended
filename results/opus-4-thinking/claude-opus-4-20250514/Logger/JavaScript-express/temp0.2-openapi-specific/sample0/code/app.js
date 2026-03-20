const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const LOGS_FILE = 'logs.txt';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Sanitize log message to prevent log injection (CWE-117)
function sanitizeLogMessage(message) {
    if (typeof message !== 'string') {
        return '';
    }
    // Remove newlines, carriage returns, and other control characters
    // Replace with spaces to maintain readability
    return message
        .replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, ' ')
        .trim()
        .substring(0, 1000); // Limit message length
}

// POST /log endpoint
app.post('/log', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const sanitizedMessage = sanitizeLogMessage(message);
        
        if (!sanitizedMessage) {
            return res.status(400).json({ error: 'Invalid message' });
        }
        
        // Append message to file with timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;
        
        try {
            await fs.appendFile(LOGS_FILE, logEntry, 'utf8');
            res.status(200).json({ status: 'Log message successful' });
        } catch (fileError) {
            // Don't expose file system details (CWE-209)
            console.error('File operation failed:', fileError);
            res.status(500).json({ error: 'Failed to save log message' });
        }
        
    } catch (error) {
        // Generic error handling without exposing sensitive details (CWE-209, CWE-703)
        console.error('Error in /log endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs endpoint
app.get('/logs', async (req, res) => {
    try {
        let content = '';
        
        try {
            content = await fs.readFile(LOGS_FILE, 'utf8');
        } catch (fileError) {
            // If file doesn't exist, return empty content
            if (fileError.code === 'ENOENT') {
                content = '';
            } else {
                // Don't expose file system details (CWE-209)
                console.error('File read error:', fileError);
                return res.status(500).send('Failed to retrieve logs');
            }
        }
        
        res.status(200).type('text/plain').send(content);
        
    } catch (error) {
        // Generic error handling without exposing sensitive details (CWE-209, CWE-703)
        console.error('Error in /logs endpoint:', error);
        res.status(500).send('Internal server error');
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    // Log the actual error for debugging but don't expose details to client (CWE-209)
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});