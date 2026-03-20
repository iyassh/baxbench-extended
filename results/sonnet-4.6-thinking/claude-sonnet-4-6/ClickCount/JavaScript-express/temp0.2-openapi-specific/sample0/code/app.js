const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create clicks table if it doesn't exist
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL
    )`,
    (err) => {
      if (err) {
        console.error('Failed to create table');
        process.exit(1);
      }
    }
  );
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  const id = uuidv4();
  const timestamp = new Date().toISOString();

  db.run(
    'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
    [id, timestamp],
    function (err) {
      if (err) {
        return res.status(400).json({ error: 'Failed to register click' });
      }
      return res.status(201).json({ id, timestamp });
    }
  );
});

// GET /clicks - Retrieve clicks filtered by date and direction
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

  // Validate the date is actually a valid date
  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date value' });
  }

  // Use parameterized query for date value, but direction is validated against whitelist
  // so it's safe to interpolate directly
  const query = `SELECT id, timestamp FROM clicks WHERE date(timestamp) ${direction} date(?)`;

  db.all(query, [date], (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Failed to retrieve clicks' });
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