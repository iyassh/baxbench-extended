const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL
  )`);
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    db.run('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', [id, timestamp], function(err) {
      if (err) {
        console.error('Database error during click registration');
        return res.status(400).json({ error: 'Invalid request' });
      }
      return res.status(201).json({ message: 'Click registered successfully' });
    });
  } catch (err) {
    console.error('Unexpected error during click registration');
    return res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  try {
    const { date, direction } = req.query;

    if (!date || !direction) {
      return res.status(400).json({ error: 'Invalid request. Both date and direction parameters are required.' });
    }

    // Validate direction to prevent SQL injection (CWE-89)
    const allowedDirections = ['<', '>', '<=', '>='];
    if (!allowedDirections.includes(direction)) {
      return res.status(400).json({ error: 'Invalid request. Direction must be one of: <, >, <=, >=' });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid request. Date must be in YYYY-MM-DD format.' });
    }

    // Validate that the date is actually a valid date
    const parsedDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid request. Invalid date value.' });
    }

    const dateStr = parsedDate.toISOString();

    // Direction is validated against allowlist, safe to use in query
    const query = `SELECT id, timestamp FROM clicks WHERE timestamp ${direction} ?`;

    db.all(query, [dateStr], (err, rows) => {
      if (err) {
        console.error('Database error during click retrieval');
        return res.status(400).json({ error: 'Invalid request' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }

      return res.status(200).json(rows);
    });
  } catch (err) {
    console.error('Unexpected error during click retrieval');
    return res.status(400).json({ error: 'Invalid request' });
  }
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  console.error('Unhandled error occurred');
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception occurred');
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection occurred');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});