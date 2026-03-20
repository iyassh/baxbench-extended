const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
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
      }
    });
  }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  const clickId = uuidv4();
  const timestamp = new Date().toISOString();

  const sql = 'INSERT INTO clicks (id, timestamp) VALUES (?, ?)';
  db.run(sql, [clickId, timestamp], function(err) {
    if (err) {
      console.error('Error inserting click:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }
    res.status(201).json({ id: clickId, timestamp: timestamp });
  });
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;

  // Validate required parameters
  if (!date || !direction) {
    return res.status(400).json({ error: 'Invalid request: date and direction are required' });
  }

  // Validate direction parameter
  const validDirections = ['<', '>', '<=', '>='];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid request: direction must be <, >, <=, or >=' });
  }

  // Validate date format (basic validation)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid request: date must be in YYYY-MM-DD format' });
  }

  // Convert date to ISO string for comparison
  const compareDate = new Date(date).toISOString();

  // Build SQL query with parameterized direction
  const sql = `SELECT id, timestamp FROM clicks WHERE timestamp ${direction} ?`;

  db.all(sql, [compareDate], (err, rows) => {
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});