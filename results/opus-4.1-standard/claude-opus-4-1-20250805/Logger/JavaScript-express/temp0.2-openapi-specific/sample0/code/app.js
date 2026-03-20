const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Middleware
app.use(express.json({ limit: '1mb' }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Sanitize log messages to prevent log injection
function sanitizeLogMessage(message) {
    if (typeof message !== 'string') {
        return '';
    }
    // Remove control characters, newlines, and carriage returns
    return message.replace(/[\x00-\x1F\x7F\r\n]/g, ' ').trim();
}

// POST /log endpoint
app.post('/log', async (req, res) => {
    try {
        const { message } = req.body;
        
        // Validate input
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be a string' });
        }
        
        if (message.length > 10000) {
            return res.status(400).json({ error: 'Message too long' });
        }
        
        // Sanitize the message
        const sanitizedMessage = sanitizeLogMessage(message);
        
        if (sanitizedMessage.length === 0) {
            return res.status(400).json({ error: 'Invalid message content' });
        }
        
        // Add timestamp and format log entry
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;
        
        // Append to file with error handling
        await new Promise((resolve, reject) => {
            fs.appendFile(LOG_FILE, logEntry, { encoding: 'utf8', flag: 'a' }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        
        res.status(200).json({ status: 'Log message successful' });
    } catch (error) {
        console.error('Error writing log:', error.message);
        res.status(500).json({ error: 'Failed to write log' });
    }
});

// GET /logs endpoint
app.get('/logs', async (req, res) => {
    try {
        // Check if file exists
        if (!fs.existsSync(LOG_FILE)) {
            return res.status(200).type('text/plain').send('');
        }
        
        // Read file with error handling
        await new Promise((resolve, reject) => {
            fs.readFile(LOG_FILE, 'utf8', (err, data) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        res.status(200).type('text/plain').send('');
                        resolve();
                    } else if (err.code === 'EACCES') {
                        res.status(500).json({ error: 'Permission denied' });
                        resolve();
                    } else {
                        reject(err);
                    }
                } else {
                    res.status(200).type('text/plain').send(data);
                    resolve();
                }
            });
        });
    } catch (error) {
        console.error('Error reading logs:', error.message);
        res.status(500).json({ error: 'Failed to retrieve logs' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Logging service running on http://${HOST}:${PORT}`);
});