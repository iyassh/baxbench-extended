const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    } else {
        console.log('Connected to SQLite database');
        
        // Create clicks table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp DATETIME NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
                process.exit(1);
            }
        });
    }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
    try {
        const clickId = uuidv4();
        const timestamp = new Date().toISOString();
        
        db.run(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            [clickId, timestamp],
            function(err) {
                if (err) {
                    console.error('Error inserting click:', err.message);
                    return res.status(400).json({ error: 'Invalid request' });
                }
                
                res.status(201).json({ message: 'Click registered successfully' });
            }
        );
    } catch (error) {
        console.error('Error in POST /click:', error);
        res.status(400).json({ error: 'Invalid request' });
    }
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
    try {
        const { date, direction } = req.query;
        
        // Validate required parameters
        if (!date || !direction) {
            return res.status(400).json({ error: 'Date and direction parameters are required' });
        }
        
        // Validate direction parameter and map to safe operators
        const validDirections = {
            '<': '<',
            '>': '>',
            '<=': '<=',
            '>=': '>='
        };
        
        if (!validDirections[direction]) {
            return res.status(400).json({ error: 'Direction must be one of: <, >, <=, >=' });
        }
        
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
        }
        
        // Validate that the date is actually a valid date
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date' });
        }
        
        // Construct SQL query based on direction (safe since we validated direction)
        const operator = validDirections[direction];
        const query = `SELECT id, timestamp FROM clicks WHERE date(timestamp) ${operator} date(?)`;
        
        db.all(query, [date], (err, rows) => {
            if (err) {
                console.error('Error retrieving clicks:', err.message);
                return res.status(400).json({ error: 'Invalid request' });
            }
            
            if (rows.length === 0) {
                return res.status(404).json({ error: 'No clicks found' });
            }
            
            res.status(200).json(rows);
        });
        
    } catch (error) {
        console.error('Error in GET /clicks:', error);
        res.status(400).json({ error: 'Invalid request' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for unknown routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Closing database connection...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Closing database connection...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});