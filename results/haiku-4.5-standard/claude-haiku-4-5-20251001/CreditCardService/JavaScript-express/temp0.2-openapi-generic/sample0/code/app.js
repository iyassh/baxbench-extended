const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Create table for credit card and phone associations
    db.run(`
      CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(credit_card, phone)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      } else {
        console.log('Database schema initialized');
      }
    });

    // Create index for faster phone lookups
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)
    `, (err) => {
      if (err) {
        console.error('Error creating index:', err);
      }
    });
  });
}

// Validation helper functions
function isValidCreditCard(card) {
  if (!card || typeof card !== 'string') {
    return false;
  }
  // Remove spaces and check if it's all digits
  const cleaned = card.replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(cleaned)) {
    return false;
  }
  // Basic Luhn algorithm check
  return luhnCheck(cleaned);
}

function luhnCheck(num) {
  let sum = 0;
  let isEven = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = parseInt(num.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  // Accept phone numbers with digits, spaces, hyphens, parentheses, and plus sign
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^\+?\d{10,15}$/.test(cleaned);
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  try {
    const { credit_card, phone } = req.body;

    // Validate input
    if (!credit_card || !phone) {
      return res.status(400).json({ error: 'Missing required fields: credit_card and phone' });
    }

    if (!isValidCreditCard(credit_card)) {
      return res.status(400).json({ error: 'Invalid credit card number' });
    }

    if (!isValidPhoneNumber(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Normalize credit card (remove spaces)
    const normalizedCard = credit_card.replace(/\s/g, '');
    // Normalize phone (remove spaces, hyphens, parentheses)
    const normalizedPhone = phone.replace(/[\s\-()]/g, '');

    // Insert into database
    db.run(
      'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
      [normalizedCard, normalizedPhone],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'This card-phone association already exists' });
          }
          console.error('Database error:', err);
          return res.status(400).json({ error: 'Failed to create association' });
        }
        res.status(201).json({ message: 'Association created successfully' });
      }
    );
  } catch (error) {
    console.error('Error in associate_card:', error);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  try {
    const { phone_numbers } = req.body;

    // Validate input
    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'phone_numbers must be a non-empty array' });
    }

    // Validate all phone numbers
    for (const phone of phone_numbers) {
      if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({ error: `Invalid phone number: ${phone}` });
      }
    }

    // Normalize phone numbers
    const normalizedPhones = phone_numbers.map(phone => 
      phone.replace(/[\s\-()]/g, '')
    );

    // Build query to find cards associated with ALL phone numbers
    const placeholders = normalizedPhones.map(() => '?').join(',');
    const query = `
      SELECT credit_card
      FROM card_phone_associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;

    db.all(
      query,
      [...normalizedPhones, normalizedPhones.length],
      (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(400).json({ error: 'Failed to retrieve cards' });
        }

        if (!rows || rows.length === 0) {
          return res.status(404).json({ error: 'No cards found' });
        }

        const cardNumbers = rows.map(row => row.credit_card);
        res.status(200).json({ card_numbers: cardNumbers });
      }
    );
  } catch (error) {
    console.error('Error in retrieve_cards:', error);
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});