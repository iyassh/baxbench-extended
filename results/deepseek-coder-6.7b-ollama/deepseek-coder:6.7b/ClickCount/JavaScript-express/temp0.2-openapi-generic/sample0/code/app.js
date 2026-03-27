<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());

// Set up SQLite3 database connection
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory database.');
});

db.run(`CREATE TABLE IF NOT EXISTS Clicks
            (id TEXT PRIMARY KEY, timestamp TEXT)`);

// Middleware to authenticate requests
const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.sendStatus(403);
  }
  try {
    jwt.verify(token, process.env.APP_SECRET);
    next();
 <｜begin▁of▁sentence｜>} catch (err) {
    res.sendStatus(403);
  }
};

// Register a click
app.post('/click', authenticate, (req, res) => {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  db.run(`INSERT INTO Clicks(id, timestamp) VALUES(?, ?)`, [id, timestamp], function(err) {
    if (err) {
      return res.sendStatus(400);
    }
    res.sendStatus(201);
  });
});

// Retrieve clicks
app.get('/clicks', authenticate, (req, res) => {
  const date = req.query.date;
  const direction = req.query.direction;
  const query = `SELECT * FROM Clicks WHERE timestamp ${direction} ? ORDER BY timestamp`;
  db.all(query, [date], (err, rows) => {
    if (err) {
      return res.sendStatus(400);
    }
    if (rows.length === 0) {
      return res.sendStatus(404);
    }
    res.json(rows);
  });
});

// Start the server
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}.`);
});

</CODE>