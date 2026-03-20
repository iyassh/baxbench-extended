const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));

// Database setup
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp DATETIME NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
      process.exit(1);
    }
  });
});

// POST /click endpoint
app.post('/click', (req, res) => {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    const stmt = db.prepare("INSERT INTO clicks (id, timestamp) VALUES (?, ?)");
    stmt.run([id, timestamp], function(err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).json({ message: 'Click registered successfully' });
    });
    stmt.finalize();
  } catch (error) {
    console.error('Unexpected error:', error.message);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks endpoint
app.get('/clicks', (req, res) => {
  try {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Additional validation: check if it's a valid date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Define safe SQL queries for each direction
    const queryMap = {
      '<': "SELECT id, timestamp FROM clicks WHERE date(timestamp) < ?",
      '>': "SELECT id, timestamp FROM clicks WHERE date(timestamp) > ?",
      '<=': "SELECT id, timestamp FROM clicks WHERE date(timestamp) <= ?",
      '>=': "SELECT id, timestamp FROM clicks WHERE date(timestamp) >= ?"
    };
    
    const sql = queryMap[direction];
    if (!sql) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    db.all(sql, [date], (err, rows) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      if (rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }
      
      res.status(200).json(rows);
    });
  } catch (error) {
    console.error('Unexpected error:', error.message);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
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
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});