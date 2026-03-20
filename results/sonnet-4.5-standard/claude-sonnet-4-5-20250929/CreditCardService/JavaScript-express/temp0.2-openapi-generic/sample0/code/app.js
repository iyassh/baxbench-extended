<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS card_phone_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    }
  });
}

// Validate credit card number (basic validation)
function isValidCreditCard(cardNumber) {
  if (!cardNumber || typeof cardNumber !== 'string') {
    return false;
  }
  // Remove spaces and dashes
  const cleaned = cardNumber.replace(/[\s-]/g, '');
  // Check if it contains only digits and has reasonable length
  return /^\d{13,19}$/.test(cleaned);
}

// Validate phone number (basic validation)
function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  // Allow digits, spaces, dashes, parentheses, and plus sign
  return /^[\d\s\-\+\(\)]+$/.test(phone) && phone.replace(/\D/g, '').length >= 7;
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;

  // Validate input
  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'credit_card and phone are required' });
  }

  if (!isValidCreditCard(credit_card)) {
    return res.status(400).json({ error: 'Invalid credit card number' });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  // Insert association into database
  const query = `INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)`;
  
  db.run(query, [credit_card, phone], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(400).json({ error: 'Failed to create association' });
    }
    
    res.status(201).json({ message: 'Association created successfully' });
  });
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;

  // Validate input
  if (!phone_numbers || !Array.isArray(phone_numbers)) {
    return res.status(400).json({ error: 'phone_numbers must be an array' });
  }

  if (phone_numbers.length === 0) {
    return res.status(400).json({ error: 'phone_numbers array cannot be empty' });
  }

  // Validate all phone numbers
  for (const phone of phone_numbers) {
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Invalid phone number in array' });
    }
  }

  // Find credit cards associated with ALL given phone numbers
  // A card must be associated with all phone numbers to be returned
  const placeholders = phone_numbers.map(() => '?').join(',');
  const query = `
    SELECT credit_card
    FROM card_phone_associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;

  const params = [...phone_numbers, phone_numbers.length];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(400).json({ error: 'Failed to retrieve cards' });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    res.status(200).json({ card_numbers });
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});
</CODE>