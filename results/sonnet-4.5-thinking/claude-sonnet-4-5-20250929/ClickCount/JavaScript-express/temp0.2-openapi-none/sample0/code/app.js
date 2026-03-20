const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    // Create clicks table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      }
    });
  }
});

// Helper function to get next date
function getNextDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().split('T')[0];
}

// POST /click - Register a click
app.post('/click', (req, res) => {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  
  const sql = 'INSERT INTO clicks (id, timestamp) VALUES (?, ?)';
  
  db.run(sql, [id, timestamp], function(err) {
    if (err) {
      console.error('Error inserting click:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }
    res.status(201).send();
  });
});

// GET /clicks - Retrieve clicks with date filtering
app.get('/clicks', (req, res) => {
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
  
  // Build SQL query based on direction
  let sql;
  let comparisonDate;
  
  if (direction === '<') {
    sql = 'SELECT id, timestamp FROM clicks WHERE timestamp < ?';
    comparisonDate = date;
  } else if (direction === '>') {
    sql = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?';
    comparisonDate = getNextDate(date);
  } else if (direction === '<=') {
    sql = 'SELECT id, timestamp FROM clicks WHERE timestamp < ?';
    comparisonDate = getNextDate(date);
  } else if (direction === '>=') {
    sql = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?';
    comparisonDate = date;
  }
  
  db.all(sql, [comparisonDate], (err, rows) => {
    if (err) {
      console.error('Error retrieving clicks:', err.message);
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }
    
    res.status(200).json(rows);
  });
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});