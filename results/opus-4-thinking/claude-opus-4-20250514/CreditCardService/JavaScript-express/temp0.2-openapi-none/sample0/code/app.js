const express = require('express');
const sqlite3 = require('sqlite3').verbose();

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

// POST /associate_card endpoint
app.post('/associate_card', (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  const { credit_card, phone } = req.body;
  
  // Validate input
  if (!credit_card || !phone || typeof credit_card !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Insert association
  db.run(
    'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
    (err) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).send();
    }
  );
});

// POST /retrieve_cards endpoint
app.post('/retrieve_cards', (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  const { phone_numbers } = req.body;
  
  // Validate input
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Validate each phone number
  for (const phone of phone_numbers) {
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }
  }
  
  // Remove duplicates
  const uniquePhoneNumbers = [...new Set(phone_numbers)];
  
  // Build query to find cards associated with ALL given phone numbers
  const placeholders = uniquePhoneNumbers.map(() => '?').join(',');
  const query = `
    SELECT credit_card
    FROM card_phone_associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;
  
  const params = [...uniquePhoneNumbers, uniquePhoneNumbers.length];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    const card_numbers = rows.map(row => row.credit_card);
    res.status(200).json({ card_numbers });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});