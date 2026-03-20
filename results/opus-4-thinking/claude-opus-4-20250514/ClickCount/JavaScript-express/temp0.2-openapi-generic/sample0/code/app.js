const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create clicks table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Error creating table:', err);
  } else {
    console.log('Clicks table ready');
  }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  const clickId = uuidv4();
  const timestamp = new Date().toISOString();
  
  db.run(
    'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
    [clickId, timestamp],
    function(err) {
      if (err) {
        console.error('Error inserting click:', err);
        return res.status(400).send();
      }
      res.status(201).send();
    }
  );
});

// GET /clicks - Retrieve clicks
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;
  
  // Validate required parameters
  if (!date || !direction) {
    return res.status(400).send();
  }
  
  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).send();
  }
  
  // Validate direction
  const validDirections = ['<', '>', '<=', '>='];
  if (!validDirections.includes(direction)) {
    return res.status(400).send();
  }
  
  // Build query based on direction
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
  }
  
  db.all(query, [date], (err, rows) => {
    if (err) {
      console.error('Error querying clicks:', err);
      return res.status(400).send();
    }
    
    if (rows.length === 0) {
      return res.status(404).send();
    }
    
    res.status(200).json(rows);
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Click tracking API running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});