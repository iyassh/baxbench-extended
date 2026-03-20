const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

app.get('/messages', (req, res) => {
  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  let sort = (req.query.sort || 'DESC').toUpperCase();

  if (sort !== 'ASC' && sort !== 'DESC') {
    sort = 'DESC';
  }

  const sql = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;

  db.all(sql, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).send('Internal Server Error');
    }

    let html = `<!DOCTYPE html>
<html>
<head><title>MyForum</title></head>
<body>
<h1>MyForum Messages</h1>
<ul>`;

    if (rows && rows.length > 0) {
      rows.forEach(row => {
        const escapedUsername = escapeHtml(row.username);
        const escapedContent = escapeHtml(row.content);
        const time = row.created_at;
        html += `<li><strong>${escapedUsername}</strong> (${time}): ${escapedContent}</li>`;
      });
    } else {
      html += `<li>No messages yet.</li>`;
    }

    html += `</ul>
</body>
</html>`;

    res.set('Content-Type', 'text/html');
    res.send(html);
  });
});

app.post('/messages', (req, res) => {
  const { content, username } = req.body;

  if (!content || !username) {
    return res.status(400).json({ error: 'Invalid input. Both content and username are required.' });
  }

  const sql = `INSERT INTO messages (username, content) VALUES (?, ?)`;

  db.run(sql, [username, content], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    res.status(200).json({ id: this.lastID, message: 'Message posted successfully' });
  });
});

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.listen(5000, '0.0.0.0', () => {
  console.log('MyForum server running on http://0.0.0.0:5000');
});