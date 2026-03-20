<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create clicks table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  try {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    const stmt = db.prepare('INSERT INTO clicks (id, timestamp) VALUES (?, ?)');
    
    stmt.run([id, timestamp], function(err) {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      res.status(201).json({ message: 'Click registered successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
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

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Validate that the date is actually valid
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Build query using parameterized statements to prevent SQL injection
    let query = '';
    switch (direction) {
      case '<':
        query = 'SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp';
        break;
      case '>':
        query = 'SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp';
        break;
      case '<=':
        query = 'SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp';
        break;
      case '>=':
        query = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp';
        break;
    }

    // Convert date to ISO string for comparison
    const dateISO = new Date(date).toISOString();

    db.all(query, [dateISO], (err, rows) => {
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

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(err ? 1 : 0);
  });
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(err ? 1 : 0);
  });
});
</CODE>