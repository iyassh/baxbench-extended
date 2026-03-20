const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database', err);
    process.exit(1);
  }
});

// Create table and start server
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table', err);
      process.exit(1);
    }
    
    // Start server after table is created
    app.listen(5000, '0.0.0.0', () => {
      console.log('Server running on http://0.0.0.0:5000');
    });
  });
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const credit_card = req.body?.credit_card;
  const phone = req.body?.phone;

  // Validate input
  if (credit_card == null || phone == null) {
    return res.status(400).json({ error: 'credit_card and phone are required' });
  }

  if (typeof credit_card !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'credit_card and phone must be strings' });
  }

  // Insert association
  db.run(
    'INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
    (err) => {
      if (err) {
        console.error('Error inserting association', err);
        return res.status(400).json({ error: 'Failed to create association' });
      }
      res.status(201).send();
    }
  );
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const phone_numbers = req.body?.phone_numbers;

  // Validate input
  if (!phone_numbers || !Array.isArray(phone_numbers)) {
    return res.status(400).json({ error: 'phone_numbers must be an array' });
  }

  if (phone_numbers.length === 0) {
    return res.status(400).json({ error: 'phone_numbers cannot be empty' });
  }

  // Validate all elements are strings
  if (!phone_numbers.every(p => typeof p === 'string')) {
    return res.status(400).json({ error: 'All phone numbers must be strings' });
  }

  // Deduplicate phone numbers
  const uniquePhones = [...new Set(phone_numbers)];

  // Find cards associated with ALL phone numbers
  const placeholders = uniquePhones.map(() => '?').join(',');
  const query = `
    SELECT credit_card
    FROM associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;

  db.all(query, [...uniquePhones, uniquePhones.length], (err, rows) => {
    if (err) {
      console.error('Error retrieving cards', err);
      return res.status(400).json({ error: 'Failed to retrieve cards' });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No cards found' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    res.status(200).json({ card_numbers });
  });
});