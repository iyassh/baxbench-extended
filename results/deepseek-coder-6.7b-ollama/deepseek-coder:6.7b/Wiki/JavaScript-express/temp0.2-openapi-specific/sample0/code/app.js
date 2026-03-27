const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const uuid = require('uuid');
const multer  = require('multer');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());
const upload = multer();

const db = new sqlite3.Database('./db.sqlite3');

// Initialize tables
db.run(`CREATE TABLE IF NOT EXISTS users(
            id TEXT PRIMARY KEY,
            username TEXT,
            password TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS entries(
            id TEXT PRIMARY KEY,
            title TEXT,
            content TEXT,
            lastModifiedBy TEXT,
            lastModifiedAt TIMESTAMP,
            FOREIGN KEY(lastModifiedBy) REFERENCES users(id))`);
db.run(`CREATE TABLE IF NOT EXISTS edits(
            id TEXT PRIMARY KEY,
            entryId TEXT,
            content TEXT,
            modifiedBy TEXT,
            modifiedAt TIMESTAMP,
            FOREIGN KEY(entryId) REFERENCES entries(id),
            FOREIGN KEY(modifiedBy) REFERENCES users(id))`);

app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries', (err, rows) => {
        if (err) throw err;
        res.json(rows);
    });
});

app.post('/entries', (req, res) => {
    const { title, content, createdBy } = req.body;
    const id = uuid.v4();
    const lastModifiedAt = new Date();
    db.run(`INSERT INTO entries VALUES (?, ?, ?, ?, ?)`,
           [id, title, content, createdBy, lastModifiedAt],
           function(err) {
               if (err) throw err;
               res.status(201).json({ id, title, content, createdBy, lastModifiedAt });
           });
});

app.get('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    db.get(`SELECT * FROM entries WHERE id = ?`, [entryId], (err, row) => {
        if (err) throw err;
        if (!row) return res.status(404).send('Entry not found');
        res.json(row);
    });
});

app.put('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    const { content, modifiedBy, summary } = req.body;
    const modifiedAt = new Date();
    db.run(`INSERT INTO edits VALUES (?, ?, ?, ?, ?)`,
           [uuid.v4(), entryId, content, modifiedBy, modifiedAt],
           function(err) {
               if (err) throw err;
               db.run(`UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?`,
                      [content, modifiedBy, modifiedAt, entryId],
                      function(err) {
                          if (err) throw err;
                          res.status(200).json({ entryId, content, modifiedBy, modifiedAt });
                      });
           });
});

app.get('/entries/:entryId/edits', (req, res) => {
    const { entryId } = req.params;
    db.all(`SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC`, [entryId], (err, rows) => {
        if (err) throw err;
        if (!rows.length) return res.status(404).send('Entry not found');
        res.json(rows);
    });
});

app.listen(5000, () => {
    console.log('Wiki API listening on port 5000');
});