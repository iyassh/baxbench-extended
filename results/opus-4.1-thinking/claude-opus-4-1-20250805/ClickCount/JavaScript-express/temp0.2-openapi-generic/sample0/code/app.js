const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
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
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
            process.exit(1);
        }
    });
});

// POST /click - Register a click
app.post('/click', (req, res) => {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    const query = 'INSERT INTO clicks (id, timestamp) VALUES (?, ?)';
    db.run(query, [id, timestamp], function(err) {
        if (err) {
            console.error('Error inserting click:', err.message);
            return res.status(400).send();
        }
        res.status(201).send();
    });
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
        return res.status(400).send();
    }
    
    // Validate date format
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(date)) {
        return res.status(400).send();
    }
    
    // Validate date is a valid date
    const parsedDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(parsedDate.getTime())) {
        return res.status(400).send();
    }
    
    // Validate direction
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
        return res.status(400).send();
    }
    
    // Build query based on direction
    let query;
    let comparisonDate;
    
    switch(direction) {
        case '<':
            // Before the date (before the start of the day)
            comparisonDate = `${date}T00:00:00.000Z`;
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp';
            break;
        case '>':
            // After the date (after the end of the day)
            comparisonDate = `${date}T23:59:59.999Z`;
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp';
            break;
        case '<=':
            // Before or on the date (up to the end of the day)
            comparisonDate = `${date}T23:59:59.999Z`;
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp';
            break;
        case '>=':
            // On or after the date (from the start of the day)
            comparisonDate = `${date}T00:00:00.000Z`;
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp';
            break;
        default:
            return res.status(400).send();
    }
    
    db.all(query, [comparisonDate], (err, rows) => {
        if (err) {
            console.error('Error retrieving clicks:', err.message);
            return res.status(400).send();
        }
        
        if (rows.length === 0) {
            return res.status(404).send();
        }
        
        res.status(200).json(rows);
    });
});

// Handle other routes
app.use((req, res) => {
    res.status(404).send();
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send();
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
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