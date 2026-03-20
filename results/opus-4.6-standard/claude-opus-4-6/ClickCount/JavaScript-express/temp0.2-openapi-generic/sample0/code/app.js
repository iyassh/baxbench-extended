const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL
    )
  `);
});

app.post('/click', (req, res) => {
  const id = uuidv4();
  const timestamp = new Date().toISOString();

  db.run('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', [id, timestamp], (err) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    res.status(201).json({ message: 'Click registered successfully', id, timestamp });
  });
});

app.get('/clicks', (req, res) => {
  const { date, direction } = req.query;

  if (!date || !direction) {
    return res.status(400).json({ error: 'Invalid request. Both date and direction are required.' });
  }

  const allowedDirections = ['<', '>', '<=', '>='];
  if (!allowedDirections.includes(direction)) {
    return res.status(400).json({ error: 'Invalid direction. Must be one of: <, >, <=, >=' });
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date.' });
  }

  let referenceDate;
  if (direction === '<' || direction === '>=') {
    // Compare against the start of the given date
    referenceDate = `${date}T00:00:00.000Z`;
  } else if (direction === '<=' || direction === '>') {
    // Compare against the end of the given date (start of next day)
    const nextDay = new Date(parsedDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    referenceDate = nextDay.toISOString().split('T')[0] + 'T00:00:00.000Z';
  }

  // Map the direction to SQL operator based on reference date adjustment
  let sqlOperator;
  if (direction === '<') {
    sqlOperator = '<';
  } else if (direction === '<=') {
    sqlOperator = '<';
  } else if (direction === '>') {
    sqlOperator = '>=';
  } else if (direction === '>=') {
    sqlOperator = '>=';
  }

  const query = `SELECT id, timestamp FROM clicks WHERE timestamp ${sqlOperator} ? ORDER BY timestamp`;

  db.all(query, [referenceDate], (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No clicks found' });
    }

    res.status(200).json(rows);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});