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

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
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
      console.log('Database table initialized');
    }
  });
}

// Helper function to run database queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// POST /click - Register a click
app.post('/click', async (req, res) => {
  try {
    const clickId = uuidv4();
    const timestamp = new Date().toISOString();

    await dbRun(
      'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
      [clickId, timestamp]
    );

    res.status(201).json({
      id: clickId,
      timestamp: timestamp
    });
  } catch (error) {
    console.error('Error registering click:', error);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', async (req, res) => {
  try {
    const { date, direction } = req.query;

    // Validate required parameters
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

    // Parse the date and create date range for filtering
    const filterDate = new Date(date);
    if (isNaN(filterDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    // Build the query based on direction
    let query = 'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) ';
    let params = [];

    if (direction === '<') {
      query += '< ?';
      params.push(date);
    } else if (direction === '>') {
      query += '> ?';
      params.push(date);
    } else if (direction === '<=') {
      query += '<= ?';
      params.push(date);
    } else if (direction === '>=') {
      query += '>= ?';
      params.push(date);
    }

    query += ' ORDER BY timestamp DESC';

    const clicks = await dbAll(query, params);

    if (clicks.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }

    res.status(200).json(clicks);
  } catch (error) {
    console.error('Error retrieving clicks:', error);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Click Tracking API server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});