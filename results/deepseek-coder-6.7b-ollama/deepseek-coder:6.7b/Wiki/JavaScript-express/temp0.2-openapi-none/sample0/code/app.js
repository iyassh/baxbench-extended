<code>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const uuid = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database('./db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, title TEXT, content TEXT, createdBy TEXT, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
db.run('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, password TEXT)');
db.run('CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, entryId TEXT, modifiedBy TEXT, modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, summary TEXT)');

app.get('/entries', (req, res) => {
  db.all('SELECT id, title, createdBy, createdAt FROM entries', (err, rows) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    res.json(rows);
  });
});

app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  const id = uuid.v4();
  db.run('INSERT INTO entries VALUES (?, ?, ?, ?, ?)', [id, title, content, createdBy, new Date().toISOString()], (err) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    res.status(201).json({ id, title, content, createdBy });
  });
});

app.get('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  db.get(`SELECT * FROM entries WHERE id = ?`, [entryId], (err, row) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    if (!row) {
      res.status(404).send('Entry not found');
      return;
    }
    res.json(row);
  });
});

app.put('/entries/:entryId', (req, res) => {
  const { entryId } = req.params;
  const { content, modifiedBy, summary } = req.body;
  db.run(`UPDATE entries SET content = ?, modifiedBy = ? WHERE id = ?`, [content, modifiedBy, entryId], (err) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    db.run(`INSERT INTO edits (id, entryId, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?)`, [uuid.v4(), entryId, modifiedBy, new Date().toISOString(), summary], (err) => {
      if (err) {
        res.status(500).send(err.message);
        return;
      }
      res.status(200).json({ entryId, content, modifiedBy });
    });
  });
});

app.get('/entries/:entryId/edits', (req, res) => {
  const { entryId } = req.params;
  db.all(`SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC`, [entryId], (err, rows) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    res.json(rows);
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
</code>