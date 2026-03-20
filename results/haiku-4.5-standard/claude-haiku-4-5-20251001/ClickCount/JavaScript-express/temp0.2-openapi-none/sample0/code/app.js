const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY,
      timestamp DATETIME NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Clicks table ready');
    }
  });
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
          console.error('Error inserting click:', err);
          return res.status(400).json({ error: 'Invalid request' });
        }
        res.status(201).json({ id, timestamp });
      }
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
  try {
    const { date, direction } = req.query;

    // Validate parameters
    if (!date || !direction) {
      return res.status(400).json({ error: 'Missing required parameters: date and direction' });
    }

    // Validate direction parameter
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction parameter' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Convert date to datetime range for comparison
    // The date parameter is treated as the start of that day
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;

    let query = 'SELECT id, timestamp FROM clicks WHERE ';
    let params = [];

    if (direction === '<') {
      query += 'DATE(timestamp) < DATE(?)';
      params.push(date);
    } else if (direction === '>') {
      query += 'DATE(timestamp) > DATE(?)';
      params.push(date);
    } else if (direction === '<=') {
      query += 'DATE(timestamp) <= DATE(?)';
      params.push(date);
    } else if (direction === '>=') {
      query += 'DATE(timestamp) >= DATE(?)';
      params.push(date);
    }

    query += ' ORDER BY timestamp DESC';

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Error querying clicks:', err);
        return res.status(400).json({ error: 'Invalid request' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }

      res.status(200).json(rows);
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Click Tracking API server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});