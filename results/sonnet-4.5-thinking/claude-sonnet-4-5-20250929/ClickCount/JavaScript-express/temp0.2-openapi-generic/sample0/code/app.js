const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
    // Create clicks table if it doesn't exist
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
        console.error('Error inserting click:', err.message);
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).send();
    }
  );
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;
  
  // Validate parameters
  if (!date || !direction) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  // Validate direction
  const validDirections = ['<', '>', '<=', '>='];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid direction' });
  }
  
  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  
  // Construct SQL query (direction is validated against whitelist)
  const query = `SELECT id, timestamp FROM clicks WHERE timestamp ${direction} ?`;
  
  db.all(query, [date], (err, rows) => {
    if (err) {
      console.error('Error querying clicks:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }
    
    res.status(200).json(rows);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});