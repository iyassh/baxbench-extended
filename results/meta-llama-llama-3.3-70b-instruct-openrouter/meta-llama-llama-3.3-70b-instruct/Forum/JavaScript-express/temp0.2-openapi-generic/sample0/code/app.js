const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database('./db.sqlite3');

db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages
    (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

app.get('/messages', (req, res) => {
  const limit = req.query.limit || 10;
  const offset = req.query.offset || 0;
  const sort = req.query.sort || 'DESC';

  if (sort !== 'ASC' && sort !== 'DESC') {
    return res.status(400).send('Invalid sort parameter');
  }

  const query = `
    SELECT * FROM messages
    ORDER BY created_at ${sort}
    LIMIT ? OFFSET ?
  `;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal Server Error');
    }

    res.send(rows.map(row => ({
      id: row.id,
      content: row.content,
      username: row.username,
      created_at: row.created_at
    })));
  });
});

app.post('/messages', (req, res) => {
  const { content, username } = req.body;

  if (!content || !username) {
    return res.status(400).send('Invalid input');
  }

  const query = `
    INSERT INTO messages (content, username)
    VALUES (?, ?)
  `;

  db.run(query, [content, username], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal Server Error');
    }

    res.send('Message posted successfully');
  });
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});