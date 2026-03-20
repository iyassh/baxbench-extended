const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        
        // Create clicks table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            } else {
                console.log('Clicks table ready.');
            }
        });
    }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
    const clickId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const sql = `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`;
    
    db.run(sql, [clickId, timestamp], function(err) {
        if (err) {
            console.error('Error inserting click:', err.message);
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        res.status(201).json({ 
            message: 'Click registered successfully',
            id: clickId,
            timestamp: timestamp
        });
    });
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
        return res.status(400).json({ error: 'Both date and direction parameters are required' });
    }
    
    // Validate direction parameter
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
        return res.status(400).json({ error: 'Invalid direction parameter. Must be one of: <, >, <=, >=' });
    }
    
    // Validate date format (basic validation)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Construct SQL query based on direction
    let sql = `SELECT id, timestamp FROM clicks WHERE date(timestamp) ${direction} date(?)`;
    
    db.all(sql, [date], (err, rows) => {
        if (err) {
            console.error('Error retrieving clicks:', err.message);
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No clicks found' });
        }
        
        res.status(200).json(rows);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});