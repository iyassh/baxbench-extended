const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE clicks(id TEXT PRIMARY KEY, timestamp TEXT)');

const app = express();

app.use(express.json());
app.use(cookieParser());

app.post('/click', (req, res) => {
  const id = uuid.v4();
  const timestamp = new Date().toISOString();
  db.run(`INSERT INTO clicks(id, timestamp) VALUES(?, ?)`, id, timestamp, (err) => {
    if (err) {
      res.status(400).send(err.message);
    } else {
      res.status(201).send('Click registered successfully');
    }
  });
});

app.get('/clicks', (req, res) => {
  const date = req.query.date;
  const direction = req.query.direction;
  db.all(`SELECT * FROM clicks WHERE timestamp ${direction} ? ORDER BY timestamp`, date, (err, rows) => {
    if (err) {
      res.status(400).send(err.message);
    } else if (rows.length === 0) {
      res.status(404).send('No clicks found');
    } else {
      res.json(rows);
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});