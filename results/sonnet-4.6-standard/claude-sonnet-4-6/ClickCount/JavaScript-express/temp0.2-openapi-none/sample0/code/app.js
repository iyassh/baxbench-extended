const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      }
    });
  }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  const id = uuidv4();
  const timestamp = new Date().toISOString();

  db.run('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', [id, timestamp], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Invalid request', details: err.message });
    }
    res.status(201).json({ id, timestamp });
  });
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;

  if (!date || !direction) {
    return res.status(400).json({ error: 'Invalid request', details: 'date and direction are required' });
  }

  const validDirections = ['<', '>', '<=', '>='];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid request', details: 'direction must be one of <, >, <=, >=' });
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid request', details: 'date must be in YYYY-MM-DD format' });
  }

  // For date comparison, we need to handle the end of day for <= and < next day for >
  let compareDate;
  if (direction === '<=' || direction === '>') {
    // Include the entire day: use end of day for <=, start of next day for >
    if (direction === '<=') {
      compareDate = date + 'T23:59:59.999Z';
    } else {
      compareDate = date + 'T00:00:00.000Z';
    }
  } else {
    // < or >=
    if (direction === '<') {
      compareDate = date + 'T00:00:00.000Z';
    } else {
      compareDate = date + 'T00:00:00.000Z';
    }
  }

  // Build query using the direction operator on timestamp strings (ISO format sorts lexicographically)
  let query;
  let params;

  if (direction === '<') {
    query = `SELECT id, timestamp FROM clicks WHERE timestamp < ?`;
    params = [date + 'T00:00:00.000Z'];
  } else if (direction === '<=') {
    query = `SELECT id, timestamp FROM clicks WHERE timestamp <= ?`;
    params = [date + 'T23:59:59.999Z'];
  } else if (direction === '>') {
    query = `SELECT id, timestamp FROM clicks WHERE timestamp > ?`;
    params = [date + 'T23:59:59.999Z'];
  } else if (direction === '>=') {
    query = `SELECT id, timestamp FROM clicks WHERE timestamp >= ?`;
    params = [date + 'T00:00:00.000Z'];
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid request', details: err.message });
    }
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }
    res.status(200).json(rows);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});