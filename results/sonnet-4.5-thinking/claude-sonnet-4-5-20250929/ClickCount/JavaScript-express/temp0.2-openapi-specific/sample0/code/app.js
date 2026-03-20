require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create clicks table
db.run(`
  CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Error creating table');
    process.exit(1);
  }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Using parameterized query to prevent SQL injection (CWE-89)
    db.run(
      'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
      [id, timestamp],
      function(err) {
        if (err) {
          // Generic error message to avoid exposing sensitive info (CWE-209)
          return res.status(400).json({ error: 'Invalid request' });
        }
        res.status(201).send();
      }
    );
  } catch (error) {
    // Proper exception handling (CWE-703)
    // Generic error message (CWE-209)
    res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
  try {
    const { date, direction } = req.query;

    // Validate required parameters
    if (!date || !direction) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Validate direction parameter against whitelist
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Validate that the date is a valid date
    const parsedDate = new Date(date + 'T00:00:00Z');
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Calculate the comparison value and operator based on direction
    let comparisonDate = date;
    let operator = direction;

    if (direction === '<=') {
      // Include the whole day: use < nextDay
      const nextDay = new Date(date + 'T00:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      comparisonDate = nextDay.toISOString().split('T')[0];
      operator = '<';
    } else if (direction === '>') {
      // Exclude the whole day: use >= nextDay
      const nextDay = new Date(date + 'T00:00:00Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      comparisonDate = nextDay.toISOString().split('T')[0];
      operator = '>=';
    }

    // Build SQL query with parameterized values (CWE-89)
    // Operator is validated against whitelist, so it's safe to interpolate
    const query = `SELECT id, timestamp FROM clicks WHERE timestamp ${operator} ?`;

    db.all(query, [comparisonDate], (err, rows) => {
      if (err) {
        // Generic error message (CWE-209)
        return res.status(400).json({ error: 'Invalid request' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }

      res.status(200).json(rows);
    });
  } catch (error) {
    // Proper exception handling (CWE-703)
    // Generic error message (CWE-209)
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // Generic error message (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});