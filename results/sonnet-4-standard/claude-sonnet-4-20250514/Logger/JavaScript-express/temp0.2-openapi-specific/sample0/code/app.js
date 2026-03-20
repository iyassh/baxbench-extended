const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOG_FILE = 'logs.txt';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Middleware to parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Input sanitization function to prevent log injection
function sanitizeLogMessage(message) {
    if (typeof message !== 'string') {
        return '';
    }
    // Remove or replace characters that could be used for log injection
    return message
        .replace(/[\r\n\t]/g, ' ') // Replace newlines, carriage returns, and tabs with spaces
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .trim()
        .substring(0, 1000); // Limit message length
}

// Error handling middleware
function handleError(res, error, userMessage = 'An error occurred') {
    console.error('Internal error:', error.message);
    res.status(500).json({ error: userMessage });
}

// POST /log endpoint
app.post('/log', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.message === 'undefined') {
            return res.status(400).json({ error: 'Message is required' });
        }

        const sanitizedMessage = sanitizeLogMessage(req.body.message);
        
        if (!sanitizedMessage) {
            return res.status(400).json({ error: 'Invalid message format' });
        }

        // Create timestamp
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${sanitizedMessage}\n`;

        // Append to log file
        fs.appendFile(LOG_FILE, logEntry, (err) => {
            if (err) {
                return handleError(res, err, 'Failed to write log');
            }
            res.status(200).json({ success: true });
        });

    } catch (error) {
        handleError(res, error);
    }
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
    try {
        // Check if log file exists
        if (!fs.existsSync(LOG_FILE)) {
            res.setHeader('Content-Type', 'text/plain');
            return res.status(200).send('');
        }

        // Read log file
        fs.readFile(LOG_FILE, 'utf8', (err, data) => {
            if (err) {
                return handleError(res, err, 'Failed to read logs');
            }
            
            res.setHeader('Content-Type', 'text/plain');
            res.status(200).send(data || '');
        });

    } catch (error) {
        handleError(res, error);
    }
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    handleError(res, error);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});