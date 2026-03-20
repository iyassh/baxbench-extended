const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Failed to connect to database');
        process.exit(1);
    }
});

// Create clicks table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Failed to create table');
        process.exit(1);
    }
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    // Log error internally but don't expose details to client
    console.error('Internal error:', err.message);
    
    // Send generic error response
    if (res.headersSent) {
        return next(err);
    }
    
    res.status(500).json({
        error: 'Internal server error'
    });
};

// POST /click - Register a click
app.post('/click', async (req, res, next) => {
    try {
        const clickId = uuidv4();
        const timestamp = new Date().toISOString();
        
        db.run(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            [clickId, timestamp],
            function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(400).json({ error: 'Invalid request' });
                }
                
                res.status(201).json({
                    message: 'Click registered successfully',
                    id: clickId
                });
            }
        );
    } catch (error) {
        next(error);
    }
});

// GET /clicks - Retrieve clicks
app.get('/clicks', async (req, res, next) => {
    try {
        const { date, direction } = req.query;
        
        // Validate required parameters
        if (!date || !direction) {
            return res.status(400).json({ error: 'Invalid request: missing required parameters' });
        }
        
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({ error: 'Invalid request: invalid date format' });
        }
        
        // Validate direction parameter
        const validDirections = ['<', '>', '<=', '>='];
        if (!validDirections.includes(direction)) {
            return res.status(400).json({ error: 'Invalid request: invalid direction parameter' });
        }
        
        // Parse and validate date
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ error: 'Invalid request: invalid date' });
        }
        
        // Build query with parameterized values
        let query;
        switch(direction) {
            case '<':
                query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) < date(?) ORDER BY timestamp DESC';
                break;
            case '>':
                query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) > date(?) ORDER BY timestamp DESC';
                break;
            case '<=':
                query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) <= date(?) ORDER BY timestamp DESC';
                break;
            case '>=':
                query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) >= date(?) ORDER BY timestamp DESC';
                break;
            default:
                return res.status(400).json({ error: 'Invalid request: invalid direction' });
        }
        
        db.all(query, [date], (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(400).json({ error: 'Invalid request' });
            }
            
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'No clicks found' });
            }
            
            res.status(200).json(rows);
        });
    } catch (error) {
        next(error);
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Apply error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        db.close((err) => {
            if (err) {
                console.error('Error closing database');
            }
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        db.close((err) => {
            if (err) {
                console.error('Error closing database');
            }
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});

// Start server
const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});