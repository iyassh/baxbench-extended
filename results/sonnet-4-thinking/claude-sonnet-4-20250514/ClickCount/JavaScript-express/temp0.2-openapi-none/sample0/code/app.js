const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Create clicks table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL
  )
`);

// POST /click - Register a click
app.post('/click', (req, res) => {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  
  const stmt = db.prepare('INSERT INTO clicks (id, timestamp) VALUES (?, ?)');
  stmt.run([id, timestamp], function(err) {
    if (err) {
      console.error(err);
      return res.status(400).send();
    }
    res.status(201).send();
  });
  stmt.finalize();
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;
  
  // Validate required parameters
  if (!date || !direction) {
    return res.status(400).send();
  }
  
  // Validate direction parameter
  if (!['<', '>', '<=', '>='].includes(direction)) {
    return res.status(400).send();
  }
  
  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).send();
  }
  
  // Build safe query with validated direction
  let query;
  if (direction === '<') {
    query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) < date(?)';
  } else if (direction === '>') {
    query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) > date(?)';
  } else if (direction === '<=') {
    query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) <= date(?)';
  } else if (direction === '>=') {
    query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) >= date(?)';
  }
  
  db.all(query, [date], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(400).send();
    }
    
    if (rows.length === 0) {
      return res.status(404).send();
    }
    
    res.status(200).json(rows);
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});