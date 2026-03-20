const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create clicks table if it doesn't exist
db.serialize(() => {
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
});

// Helper function to validate date format (YYYY-MM-DD)
function isValidDate(dateString) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return false;
  }
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

// Helper function to validate direction operator
function isValidDirection(direction) {
  return ['<', '>', '<=', '>='].includes(direction);
}

// POST /click - Register a click
app.post('/click', (req, res) => {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    db.run(
      'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
      [id, timestamp],
      function(err) {
        if (err) {
          return res.status(400).json({ error: 'Invalid request' });
        }
        res.status(201).json({ id, timestamp });
      }
    );
  } catch (error) {
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

    // Validate date format
    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Validate direction operator
    if (!isValidDirection(direction)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Convert date to ISO format for comparison (start of day)
    const filterDate = new Date(date).toISOString().split('T')[0];

    // Build query with parameterized statement to prevent SQL injection
    let query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) ' + direction + ' ?';
    
    db.all(query, [filterDate], (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }

      res.status(200).json(rows);
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Invalid request' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Click Tracking API listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
});