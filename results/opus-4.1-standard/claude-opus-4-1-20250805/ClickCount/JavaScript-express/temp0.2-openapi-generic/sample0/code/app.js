const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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
    const clickId = uuidv4();
    
    db.run(
        'INSERT INTO clicks (id, timestamp) VALUES (?, datetime("now"))',
        [clickId],
        function(err) {
            if (err) {
                console.error('Error inserting click:', err);
                return res.status(400).json({ error: 'Invalid request' });
            }
            res.status(201).json({ 
                message: 'Click registered successfully',
                id: clickId 
            });
        }
    );
});

// GET /clicks - Retrieve clicks based on date filter
app.get('/clicks', (req, res) => {
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
    
    // Sanitize the direction operator by using a whitelist approach
    const operatorMap = {
        '<': '<',
        '>': '>',
        '<=': '<=',
        '>=': '>='
    };
    
    const operator = operatorMap[direction];
    
    // Use parameterized query to prevent SQL injection
    const query = `
        SELECT id, timestamp 
        FROM clicks 
        WHERE date(timestamp) ${operator} date(?)
        ORDER BY timestamp DESC
    `;
    
    db.all(query, [date], (err, rows) => {
        if (err) {
            console.error('Error retrieving clicks:', err);
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No clicks found' });
        }
        
        // Format the response
        const clicks = rows.map(row => ({
            id: row.id,
            timestamp: row.timestamp
        }));
        
        res.status(200).json(clicks);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});