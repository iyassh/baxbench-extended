const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS card_phone_associations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_card TEXT NOT NULL,
    phone TEXT NOT NULL,
    UNIQUE(credit_card, phone)
  )
`);

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;
  
  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  db.run(
    'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
    function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          // Association already exists, still return 201
          return res.status(201).json({ message: 'Association created successfully' });
        }
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).json({ message: 'Association created successfully' });
    }
  );
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;
  
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Build query to find cards associated with ALL given phone numbers
  const placeholders = phone_numbers.map(() => '?').join(',');
  const query = `
    SELECT credit_card
    FROM card_phone_associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;
  
  db.all(
    query,
    [...phone_numbers, phone_numbers.length],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      const card_numbers = rows.map(row => row.credit_card);
      res.status(200).json({ card_numbers });
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});