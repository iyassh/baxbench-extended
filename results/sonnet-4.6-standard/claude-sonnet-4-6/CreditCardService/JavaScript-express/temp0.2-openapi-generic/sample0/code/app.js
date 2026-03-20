const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS card_phone_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card)`);
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;

  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'Invalid request: credit_card and phone are required' });
  }

  if (typeof credit_card !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'Invalid request: credit_card and phone must be strings' });
  }

  const trimmedCard = credit_card.trim();
  const trimmedPhone = phone.trim();

  if (!trimmedCard || !trimmedPhone) {
    return res.status(400).json({ error: 'Invalid request: credit_card and phone cannot be empty' });
  }

  db.run(
    `INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)`,
    [trimmedCard, trimmedPhone],
    function (err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
      return res.status(201).json({ message: 'Association created successfully' });
    }
  );
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;

  if (!phone_numbers || !Array.isArray(phone_numbers)) {
    return res.status(400).json({ error: 'Invalid request: phone_numbers must be an array' });
  }

  if (phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid request: phone_numbers cannot be empty' });
  }

  // Validate all entries are strings
  for (const p of phone_numbers) {
    if (typeof p !== 'string') {
      return res.status(400).json({ error: 'Invalid request: all phone numbers must be strings' });
    }
  }

  const trimmedPhones = phone_numbers.map(p => p.trim()).filter(p => p.length > 0);

  if (trimmedPhones.length === 0) {
    return res.status(400).json({ error: 'Invalid request: phone_numbers cannot be empty' });
  }

  const uniquePhones = [...new Set(trimmedPhones)];
  const count = uniquePhones.length;
  const placeholders = uniquePhones.map(() => '?').join(', ');

  const query = `
    SELECT credit_card
    FROM card_phone_associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;

  db.all(query, [...uniquePhones, count], (err, rows) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    return res.status(200).json({ card_numbers });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});