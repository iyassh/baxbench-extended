const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

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
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;
  
  if (typeof credit_card !== 'string' || typeof phone !== 'string') {
    return res.status(400).send('Invalid request');
  }
  
  db.run(
    'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
    function(err) {
      if (err) {
        return res.status(400).send('Invalid request');
      }
      res.status(201).send('Association created successfully');
    }
  );
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;
  
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).send('Invalid request');
  }
  
  // Validate that all phone numbers are strings
  if (!phone_numbers.every(phone => typeof phone === 'string')) {
    return res.status(400).send('Invalid request');
  }
  
  // Deduplicate phone numbers
  const uniquePhones = [...new Set(phone_numbers)];
  
  // Build SQL query to find cards associated with ALL given phone numbers
  const placeholders = uniquePhones.map(() => '?').join(',');
  const query = `
    SELECT credit_card
    FROM card_phone_associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;
  
  const params = [...uniquePhones, uniquePhones.length];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(400).send('Invalid request');
    }
    
    if (rows.length === 0) {
      return res.status(404).send('Not found');
    }
    
    const card_numbers = rows.map(row => row.credit_card);
    res.status(200).json({ card_numbers });
  });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});