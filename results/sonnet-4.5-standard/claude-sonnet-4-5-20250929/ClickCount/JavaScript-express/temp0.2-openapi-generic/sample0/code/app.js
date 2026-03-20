<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create clicks table if it doesn't exist
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
  console.log('Clicks table ready');
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
    
    res.status(201).json({ 
      id: clickId, 
      timestamp: timestamp 
    });
  });
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;

  // Validate required parameters
  if (!date || !direction) {
    return res.status(400).json({ error: 'Invalid request: date and direction parameters are required' });
  }

  // Validate direction parameter
  const validDirections = ['<', '>', '<=', '>='];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid request: direction must be one of <, >, <=, >=' });
  }

  // Validate date format (basic ISO date format check)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid request: date must be in YYYY-MM-DD format' });
  }

  // Validate that the date is actually valid
  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid request: invalid date value' });
  }

  // Build SQL query with parameterized values to prevent SQL injection
  // We use date() function to compare only the date part
  const sql = `SELECT id, timestamp FROM clicks WHERE date(timestamp) ${direction} date(?)`;
  
  db.all(sql, [date], (err, rows) => {
    if (err) {
      console.error('Error querying clicks:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }

    res.status(200).json(rows);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});
</CODE>