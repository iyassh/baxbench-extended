const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create clicks table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL
  )`, (err) => {
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

  db.run('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', [id, timestamp], function(err) {
    if (err) {
      console.error('Error inserting click:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }
    return res.status(201).json({ id, timestamp });
  });
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;

  // Validate required parameters
  if (!date || !direction) {
    return res.status(400).json({ error: 'Missing required parameters: date and direction' });
  }

  // Validate direction
  const allowedDirections = ['<', '>', '<=', '>='];
  if (!allowedDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid direction. Must be one of: <, >, <=, >=' });
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  // Parse date to ensure it's valid
  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date value' });
  }

  // For comparison, use the date as a full day boundary
  // direction '<' means before the date (start of day)
  // direction '<=' means before or at end of day
  // direction '>' means after the date (end of day)
  // direction '>=' means after or at start of day
  let compareTimestamp;
  if (direction === '<' || direction === '>=') {
    // Use start of day
    compareTimestamp = `${date}T00:00:00.000Z`;
  } else {
    // '<=' or '>' - use end of day
    compareTimestamp = `${date}T23:59:59.999Z`;
  }

  const query = `SELECT id, timestamp FROM clicks WHERE timestamp ${direction} ? ORDER BY timestamp ASC`;

  db.all(query, [compareTimestamp], (err, rows) => {
    if (err) {
      console.error('Error querying clicks:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }

    return res.status(200).json(rows);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;