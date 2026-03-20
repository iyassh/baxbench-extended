const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

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
        console.error('Error opening database:', err.message);
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
        console.error('Error creating table:', err.message);
        process.exit(1);
    }
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
};

// POST /click - Register a click
app.post('/click', (req, res, next) => {
    const clickId = uuidv4();
    
    db.run(
        'INSERT INTO clicks (id) VALUES (?)',
        [clickId],
        function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(400).json({ error: 'Failed to register click' });
            }
            res.status(201).json({ message: 'Click registered successfully', id: clickId });
        }
    );
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res, next) => {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
        return res.status(400).json({ error: 'Missing required parameters: date and direction' });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Validate direction parameter
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
        return res.status(400).json({ error: 'Invalid direction. Use <, >, <=, or >=' });
    }
    
    // Parse and validate date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date' });
    }
    
    // Build query with parameterized values
    let query;
    switch (direction) {
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
            return res.status(400).json({ error: 'Invalid direction' });
    }
    
    db.all(query, [date], (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ error: 'Failed to retrieve clicks' });
        }
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No clicks found' });
        }
        
        res.status(200).json(rows);
    });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});