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

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

db.run(`CREATE TABLE IF NOT EXISTS clicks (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL
)`, (err) => {
  if (err) {
    console.error('Failed to create table');
    process.exit(1);
  }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    db.run('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', [id, timestamp], (err) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      return res.status(201).json({ message: 'Click registered successfully' });
    });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  try {
    const { date, direction } = req.query;

    if (!date || !direction) {
      return res.status(400).json({ error: 'Invalid request. Both date and direction are required.' });
    }

    // Validate direction to prevent SQL injection (CWE-89)
    const allowedDirections = ['<', '>', '<=', '>='];
    if (!allowedDirections.includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction. Must be one of: <, >, <=, >=' });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Validate it's a real date
    const parsedDate = new Date(date + 'T00:00:00.000Z');
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date.' });
    }

    // For >= and >, use the start of the day; for < and <=, adjust accordingly
    let filterDate;
    if (direction === '<' || direction === '<=') {
      // For < date, compare against start of day
      // For <= date, compare against end of day
      if (direction === '<=') {
        filterDate = date + 'T23:59:59.999Z';
      } else {
        filterDate = date + 'T00:00:00.000Z';
      }
    } else {
      // For > date, compare against end of day
      // For >= date, compare against start of day
      if (direction === '>=') {
        filterDate = date + 'T00:00:00.000Z';
      } else {
        filterDate = date + 'T23:59:59.999Z';
      }
    }

    // Direction is validated against whitelist, safe to use in query
    const query = `SELECT id, timestamp FROM clicks WHERE timestamp ${direction} ?`;

    db.all(query, [filterDate], (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }

      return res.status(200).json(rows);
    });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request' });
  }
});

// Global error handler (CWE-209 - don't leak sensitive info)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});