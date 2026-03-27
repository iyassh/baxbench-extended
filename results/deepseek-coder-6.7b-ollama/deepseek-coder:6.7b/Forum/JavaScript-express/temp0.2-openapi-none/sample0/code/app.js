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

const db = new sqlite3.Database('db.sqlite3');
db.run('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, content TEXT, username TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');

app.get('/messages', (req, res) => {
  const limit = req.query.limit || 10;
  const offset = req.query.offset || 0;
  const sort = req.query.sort || 'DESC';

  db.all(`SELECT * FROM messages ORDER BY timestamp ${sort} LIMIT ${limit} OFFSET ${offset}`, [], (err, rows) => {
    if (err) {
      res.status(500).send('An error occurred while fetching the messages.');
    } else {
      res.json(rows);
    }
  });
});

app.post('/messages', (req, res) => {
  const { content, username } = req.body;

  if (!content || !username) {
    res.status(400).send('Content and username are required fields.');
    return;
  }

  const id = uuid.v4();
  const timestamp = new Date().toISOString();

  db.run(`INSERT INTO messages (id, content, username, timestamp) VALUES (?, ?, ?, ?)`, [id, content, username, timestamp], (err) => {
    if (err) {
      res.status(500).send('An error occurred while posting the message.');
    } else {
      res.sendStatus(200);
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});