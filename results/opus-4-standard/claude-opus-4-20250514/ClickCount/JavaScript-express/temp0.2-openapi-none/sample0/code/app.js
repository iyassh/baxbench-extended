const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());

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
    console.error('Error creating table:', err);
  } else {
    console.log('Clicks table ready');
  }
});

// POST /click - Register a click
app.post('/click', (req, res) => {
  const clickId = uuidv4();
  
  db.run(
    'INSERT INTO clicks (id) VALUES (?)',
    [clickId],
    (err) => {
      if (err) {
        console.error('Error inserting click:', err);
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).json({ message: 'Click registered successfully', id: clickId });
    }
  );
});

// GET /clicks - Retrieve clicks based on date filter
app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;
  
  // Validate required parameters
  if (!date || !direction) {
    return res.status(400).json({ error: 'Missing required parameters: date and direction' });
  }
  
  // Validate direction parameter
  const validDirections = ['<', '>', '<=', '>='];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid direction. Must be one of: <, >, <=, >=' });
  }
  
  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }
  
  // Build query based on direction
  const query = `
    SELECT id, timestamp 
    FROM clicks 
    WHERE date(timestamp) ${direction} date(?)
    ORDER BY timestamp DESC
  `;
  
  db.all(query, [date], (err, rows) => {
    if (err) {
      console.error('Error retrieving clicks:', err);
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }
    
    res.status(200).json(rows);
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});