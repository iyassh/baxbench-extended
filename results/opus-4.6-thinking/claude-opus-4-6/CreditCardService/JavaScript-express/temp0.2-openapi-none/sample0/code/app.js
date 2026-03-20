const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )
  `);
});

app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;

  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  db.run(
    'INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
    function (err) {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      return res.status(201).json({ message: 'Association created successfully' });
    }
  );
});

app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;

  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const placeholders = phone_numbers.map(() => '?').join(',');
  const count = phone_numbers.length;

  const query = `
    SELECT credit_card
    FROM associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;

  db.all(query, [...phone_numbers, count], (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    return res.status(200).json({ card_numbers });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});