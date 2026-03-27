const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to SQLite database
let db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the database.');
});

// Create tables if they don't exist
db.serialize(function () {
  db.run(`
    CREATE TABLE IF NOT EXISTS entries
    (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      lastModifiedBy TEXT,
      lastModifiedAt TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS edits
    (
      id TEXT PRIMARY KEY,
      entryId TEXT NOT NULL,
      modifiedBy TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (entryId) REFERENCES entries (id)
    );
  `);
});

// Get all entries
app.get('/entries', (req, res) => {
  db.all('SELECT id, title FROM entries', (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Error fetching entries');
    } else {
      res.send(rows.map((row) => ({ id: row.id, title: row.title, link: `/entries/${row.id}` })));
    }
  });
});

// Create a new entry
app.post('/entries', (req, res) => {
  const { title, content, createdBy } = req.body;
  if (!title || !content || !createdBy) {
    res.status(400).send('Title, content, and createdBy are required');
    return;
  }

  const id = uuid.v4();
  const query = `
    INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
  `;
  db.run(query, [id, title, content, createdBy], (err) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Error creating entry');
    } else {
      res.status(201).send({ id, title, content, lastModifiedBy: createdBy, lastModifiedAt: new Date().toISOString() });
    }
  });
});

// Get a specific entry
app.get('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;
  const query = `
    SELECT * FROM entries
    WHERE id = ?
  `;
  db.get(query, [entryId], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Error fetching entry');
    } else if (!row) {
      res.status(404).send('Entry not found');
    } else {
      res.send(row);
    }
  });
});

// Update an existing entry
app.put('/entries/:entryId', (req, res) => {
  const entryId = req.params.entryId;
  const { content, modifiedBy, summary } = req.body;
  if (!content || !modifiedBy || !summary) {
    res.status(400).send('Content, modifiedBy, and summary are required');
    return;
  }

  const query = `
    SELECT * FROM entries
    WHERE id = ?
  `;
  db.get(query, [entryId], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Error fetching entry');
    } else if (!row) {
      res.status(404).send('Entry not found');
    } else {
      const editId = uuid.v4();
      const editQuery = `
        INSERT INTO edits (id, entryId, modifiedBy, summary, content, createdAt)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `;
      db.run(editQuery, [editId, entryId, modifiedBy, summary, content], (err) => {
        if (err) {
          console.error(err.message);
          res.status(500).send('Error creating edit');
        } else {
          const updateQuery = `
            UPDATE entries
            SET content = ?, lastModifiedBy = ?, lastModifiedAt = datetime('now')
            WHERE id = ?
          `;
          db.run(updateQuery, [content, modifiedBy, entryId], (err) => {
            if (err) {
              console.error(err.message);
              res.status(500).send('Error updating entry');
            } else {
              res.send({ id: entryId, title: row.title, content, lastModifiedBy: modifiedBy, lastModifiedAt: new Date().toISOString() });
            }
          });
        }
      });
    }
  });
});

// View the history of edits for a specific entry
app.get('/entries/:entryId/edits', (req, res) => {
  const entryId = req.params.entryId;
  const query = `
    SELECT * FROM edits
    WHERE entryId = ?
  `;
  db.all(query, [entryId], (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Error fetching edits');
    } else if (!rows) {
      res.status(404).send('Entry not found');
    } else {
      res.send(rows);
    }
  });
});

// Start the server
const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});