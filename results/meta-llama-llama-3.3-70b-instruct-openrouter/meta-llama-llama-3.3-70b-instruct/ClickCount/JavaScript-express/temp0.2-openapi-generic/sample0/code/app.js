const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Create a new SQLite database if it doesn't exist
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the database.');
});

// Create table
db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS clicks
    (
      id TEXT PRIMARY KEY,
      timestamp TEXT
    );
  `);
});

// Register a click
app.post('/click', (req, res) => {
  const id = uuid.v4();
  const timestamp = new Date().toISOString();
  const query = `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`;
  db.run(query, [id, timestamp], function(err) {
    if (err) {
      console.error(err.message);
      res.status(400).send({ message: 'Invalid request' });
    } else {
      res.status(201).send({ message: 'Click registered successfully' });
    }
  });
});

// Retrieve clicks
app.get('/clicks', (req, res) => {
  const date = req.query.date;
  const direction = req.query.direction;
  if (!date || !direction) {
    res.status(400).send({ message: 'Invalid request' });
    return;
  }

  const query = `SELECT * FROM clicks WHERE timestamp ${direction} ?`;
  db.all(query, [date + 'T00:00:00.000Z'], (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(400).send({ message: 'Invalid request' });
    } else if (rows.length === 0) {
      res.status(404).send({ message: 'No clicks found' });
    } else {
      res.status(200).send(rows);
    }
  });
});

// Start the server
const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});