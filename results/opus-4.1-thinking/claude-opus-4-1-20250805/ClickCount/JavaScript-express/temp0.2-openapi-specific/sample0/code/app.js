const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create clicks table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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
    const clickId = uuidv4();
    const query = 'INSERT INTO clicks (id) VALUES (?)';
    
    db.run(query, [clickId], function(err) {
      if (err) {
        console.error('Database error');
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).json({ message: 'Click registered successfully' });
    });
  } catch (error) {
    console.error('Error processing click');
    res.status(400).json({ error: 'Invalid request' });
  }
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  try {
    const { date, direction } = req.query;
    
    // Validate required parameters
    if (!date || !direction) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Validate direction parameter
    const validDirections = ['<', '>', '<=', '>='];
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Build query with parameterized input to prevent SQL injection
    let query;
    switch(direction) {
      case '<':
        query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) < date(?)';
        break;
      case '>':
        query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) > date(?)';
        break;
      case '<=':
        query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) <= date(?)';
        break;
      case '>=':
        query = 'SELECT id, timestamp FROM clicks WHERE date(timestamp) >= date(?)';
        break;
      default:
        return res.status(400).json({ error: 'Invalid request' });
    }
    
    db.all(query, [date], (err, rows) => {
      if (err) {
        console.error('Database error');
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No clicks found' });
      }
      
      res.status(200).json(rows);
    });
  } catch (error) {
    console.error('Error processing request');
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception');
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection');
  process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received.');
  db.close((err) => {
    if (err) {
      console.error('Database close error');
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});