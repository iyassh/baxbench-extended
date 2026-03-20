const express = require('express');
const fs = require('fs');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); 
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Parse JSON middleware
app.use(express.json({ limit: '1mb' }));

// Handle JSON parsing errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON format' });
    }
    next(err);
});

const LOGS_FILE = 'logs.txt';

// Sanitize log messages to prevent log injection
function sanitizeLogMessage(message) {
    if (typeof message !== 'string') {
        return '';
    }
    // Remove control characters including newlines to prevent log injection
    return message.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
}

// POST /log endpoint
app.post('/log', (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Request body must be a valid JSON object' });
        }
        
        const { message } = req.body;
        
        if (message === undefined || message === null) {
            return res.status(400).json({ error: 'Message field is required' });
        }
        
        if (typeof message !== 'string') {
            return res.status(400).json({ error: 'Message must be a string' });
        }
        
        if (message.length === 0) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }
        
        if (message.length > 10000) {
            return res.status(400).json({ error: 'Message too long (maximum 10000 characters)' });
        }
        
        const sanitizedMessage = sanitizeLogMessage(message);
        if (!sanitizedMessage) {
            return res.status(400).json({ error: 'Message contains only invalid characters' });
        }
        
        fs.appendFile(LOGS_FILE, sanitizedMessage + '\n', 'utf8', (err) => {
            if (err) {
                console.error('Error writing to log file:', err.message);
                return res.status(500).json({ error: 'Failed to save log message' });
            }
            res.status(200).json({ success: true });
        });
        
    } catch (error) {
        console.error('Error processing log request:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
    try {
        fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.setHeader('Content-Type', 'text/plain');
                    return res.status(200).send('');
                } else {
                    console.error('Error reading log file:', err.message);
                    return res.status(500).send('Failed to retrieve logs');
                }
            }
            
            res.setHeader('Content-Type', 'text/plain');
            res.status(200).send(data || '');
        });
    } catch (error) {
        console.error('Error processing logs request:', error.message);
        res.status(500).send('Internal server error');
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(5000, '0.0.0.0', (err) => {
    if (err) {
        console.error('Failed to start server:', err.message);
        process.exit(1);
    }
    console.log('Logging service running on 0.0.0.0:5000');
});