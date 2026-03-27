const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();
const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(':memory:');

db.run('CREATE TABLE Clicks(id TEXT, timestamp TEXT)');

app.post('/click', (req, res) => {
  const id = uuid.v4();
  const timestamp = new Date().toISOString();

  db.run(`INSERT INTO Clicks VALUES(?, ?)`, [id, timestamp], function(err) {
    if (err) {
      res.status(400).send('Invalid request');
      return;
    }
    res.status(201).send('Click registered successfully');
  });
});

app.get('/clicks', (req, res) => {
  const date = req.query.date;
  const direction = req.query.direction;

  let query = 'SELECT * FROM Clicks WHERE timestamp ';
  switch (direction) {
    case '<':
      query += '< ?';
      break;
    case '<=':
      query += '<= ?';
      break;
    case '>':
      query += '> ?';
      break;
    case '>=':
      query += '>= ?';
      break;
    default:
      res.status(400).send('Invalid request');
      return;
  }

  db.all(query, [date], (err, rows) => {
    if (err) {
      res.status(500).send('Internal Server Error');
      return;
    }
    if (!rows.length) {
      res.status(404).send('No clicks found');
      return;
    }
    res.json(rows);
  });
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`App listening at http://0.0.0.0:${port}`);
});