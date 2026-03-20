const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create clicks table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err);
    } else {
        console.log('Clicks table ready');
    }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    db.run(
        'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
        [id, timestamp],
        function(err) {
            if (err) {
                console.error('Error inserting click:', err);
                res.status(400).json({ error: 'Invalid request' });
            } else {
                res.status(201).json({ message: 'Click registered successfully' });
            }
        }
    );
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
        return res.status(400).json({ error: 'Missing required parameters: date and direction' });
    }
    
    // Validate direction parameter
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
        return res.status(400).json({ error: 'Invalid direction. Must be one of: <, >, <=, >=' });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Convert date to ISO string for comparison
    const dateTime = new Date(date + 'T00:00:00.000Z').toISOString();
    
    // Build SQL query based on direction
    let sql;
    switch(direction) {
        case '<':
            sql = 'SELECT id, timestamp FROM clicks WHERE timestamp < ?';
            break;
        case '>':
            sql = 'SELECT id, timestamp FROM clicks WHERE timestamp > ?';
            break;
        case '<=':
            sql = 'SELECT id, timestamp FROM clicks WHERE timestamp <= ?';
            break;
        case '>=':
            sql = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?';
            break;
    }
    
    db.all(sql, [dateTime], (err, rows) => {
        if (err) {
            console.error('Error retrieving clicks:', err);
            res.status(400).json({ error: 'Invalid request' });
        } else if (rows.length === 0) {
            res.status(404).json({ error: 'No clicks found' });
        } else {
            res.status(200).json(rows);
        }
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});