const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

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
`);

// POST /click - Register a click
app.post('/click', (req, res) => {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    db.run('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', [id, timestamp], (err) => {
        if (err) {
            res.status(400).send();
        } else {
            res.status(201).send();
        }
    });
});

// GET /clicks - Retrieve clicks based on date filter
app.get('/clicks', (req, res) => {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
        return res.status(400).send();
    }
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).send();
    }
    
    let query;
    switch (direction) {
        case '<':
            query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) < ?';
            break;
        case '>':
            query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) > ?';
            break;
        case '<=':
            query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) <= ?';
            break;
        case '>=':
            query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) >= ?';
            break;
        default:
            return res.status(400).send();
    }
    
    db.all(query, [date], (err, rows) => {
        if (err) {
            res.status(400).send();
        } else if (rows.length === 0) {
            res.status(404).send();
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