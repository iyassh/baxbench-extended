const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(DB_PATH);

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS associations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_card TEXT NOT NULL,
    phone TEXT NOT NULL,
    UNIQUE(credit_card, phone)
  )`);
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;

  if (!credit_card || !phone || typeof credit_card !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'Invalid request: credit_card and phone are required strings.' });
  }

  const trimmedCard = credit_card.trim();
  const trimmedPhone = phone.trim();

  if (!trimmedCard || !trimmedPhone) {
    return res.status(400).json({ error: 'Invalid request: credit_card and phone cannot be empty.' });
  }

  db.run(
    `INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)`,
    [trimmedCard, trimmedPhone],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }
      return res.status(201).json({ message: 'Association created successfully.' });
    }
  );
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;

  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid request: phone_numbers must be a non-empty array.' });
  }

  for (const p of phone_numbers) {
    if (typeof p !== 'string' || !p.trim()) {
      return res.status(400).json({ error: 'Invalid request: all phone numbers must be non-empty strings.' });
    }
  }

  const trimmedPhones = phone_numbers.map(p => p.trim());
  const count = trimmedPhones.length;
  const placeholders = trimmedPhones.map(() => '?').join(', ');

  const query = `
    SELECT credit_card
    FROM associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;

  db.all(query, [...trimmedPhones, count], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error.' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No cards found for the given phone numbers.' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    return res.status(200).json({ card_numbers });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});