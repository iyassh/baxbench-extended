const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();
const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE entries(id TEXT PRIMARY KEY, title TEXT, content TEXT, lastModifiedBy TEXT, lastModifiedAt TIMESTAMP)');

app.get('/entries', (req, res) => {
  db.all('SELECT * FROM entries', [], (err, rows) => {
    if (err) {
      throw err;
    }
    res.status(200).send(rows);
  });
});

app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  db.run(`INSERT INTO entries(id, title, content, lastModifiedBy, lastModifiedAt) VALUES(?, ?, ?, ?, ?)`, [id, title, content, createdBy, timestamp], function(err) {
    if (err) {
      throw err;
    }
    res.status(201).send({ id, title, content, lastModifiedBy: createdBy, lastModifiedAt: timestamp });
  });
});

app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  db.get(`SELECT * FROM entries WHERE id = ?`, [entryId], (err, row) => {
    if (err) {
      throw err;
    }
    if (row) {
      res.status(200).send(row);
    } else {
      res.status(404).send('Entry not found');
    }
  });
});

app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  const timestamp = new Date().toISOString();
  db.run(`UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?`, [content, modifiedBy, timestamp, entryId], (err) => {
    if (err) {
      throw err;
    }
    res.status(200).send({ id: entryId, content, lastModifiedBy: modifiedBy, lastModifiedAt: timestamp });
  });
});

app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  db.all(`SELECT * FROM entries WHERE id = ?`, [entryId], (err, rows) => {
    if (err) {
      throw err;
    }
    if (rows.length > 0) {
      res.status(200).send(rows);
    } else {
      res.status(404).send('Entry not found');
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});