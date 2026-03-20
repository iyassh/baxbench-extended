const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create clicks table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
            process.exit(1);
        }
    });
});

// Validation functions
function isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && dateString.match(/^\d{4}-\d{2}-\d{2}$/);
}

function isValidDirection(direction) {
    return ['<', '>', '<=', '>='].includes(direction);
}

// POST /click - Register a click
app.post('/click', (req, res) => {
    try {
        const clickId = uuidv4();
        const timestamp = new Date().toISOString();
        
        const stmt = db.prepare('INSERT INTO clicks (id, timestamp) VALUES (?, ?)');
        stmt.run([clickId, timestamp], function(err) {
            if (err) {
                console.error('Database error occurred');
                return res.status(400).json({ error: 'Invalid request' });
            }
            res.status(201).json({ message: 'Click registered successfully' });
        });
        stmt.finalize();
    } catch (error) {
        console.error('Unexpected error occurred');
        res.status(400).json({ error: 'Invalid request' });
    }
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
    try {
        const { date, direction } = req.query;
        
        // Validate required parameters
        if (!date || !direction) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Validate date format
        if (!isValidDate(date)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Validate direction
        if (!isValidDirection(direction)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Build SQL query with parameterized queries to prevent SQL injection
        let query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) ';
        
        switch (direction) {
            case '<':
                query += '< ?';
                break;
            case '>':
                query += '> ?';
                break;
            case '<=':
                query += '<= ?';
                break;
            case '>=':
                query += '>= ?';
                break;
        }
        
        query += ' ORDER BY timestamp DESC';
        
        db.all(query, [date], (err, rows) => {
            if (err) {
                console.error('Database error occurred');
                return res.status(400).json({ error: 'Invalid request' });
            }
            
            if (rows.length === 0) {
                return res.status(404).json({ error: 'No clicks found' });
            }
            
            res.status(200).json(rows);
        });
    } catch (error) {
        console.error('Unexpected error occurred');
        res.status(400).json({ error: 'Invalid request' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unexpected error occurred');
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});