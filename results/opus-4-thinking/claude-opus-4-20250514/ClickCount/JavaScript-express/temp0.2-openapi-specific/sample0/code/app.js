const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Database connection failed');
    process.exit(1);
  }
});

// Create clicks table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Table creation failed');
      process.exit(1);
    }
  });
});

// Register a click
app.post('/click', (req, res) => {
  const id = uuidv4();
  
  db.run('INSERT INTO clicks (id) VALUES (?)', [id], function(err) {
    if (err) {
      console.error('Database error');
      res.status(400).json({ error: 'Invalid request' });
    } else {
      res.status(201).send();
    }
  });
});

// Retrieve clicks
app.get('/clicks', (req, res) => {
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
  
  // Validate direction
  const allowedDirections = ['<', '>', '<=', '>='];
  if (!allowedDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Parse and validate date
  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Build query - direction is safe because it's validated against whitelist
  const query = `SELECT id, timestamp FROM clicks WHERE date(timestamp) ${direction} date(?)`;
  
  db.all(query, [date], (err, rows) => {
    if (err) {
      console.error('Database error');
      res.status(400).json({ error: 'Invalid request' });
    } else if (!rows || rows.length === 0) {
      res.status(404).json({ error: 'No clicks found' });
    } else {
      res.status(200).json(rows);
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

// Graceful shutdown
const gracefulShutdown = () => {
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Database close error');
      }
      process.exit(0);
    });
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception');
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection');
  gracefulShutdown();
});