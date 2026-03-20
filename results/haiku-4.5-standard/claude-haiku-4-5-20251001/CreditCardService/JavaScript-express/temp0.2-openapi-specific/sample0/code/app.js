const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', 'Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
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
      console.error('Table creation error:', 'Failed to create table');
    }
  });
});

// Helper function to validate credit card format (basic validation)
function isValidCreditCard(card) {
  if (typeof card !== 'string') return false;
  const cleaned = card.replace(/\s/g, '');
  return /^\d{13,19}$/.test(cleaned);
}

// Helper function to validate phone number format (basic validation)
function isValidPhoneNumber(phone) {
  if (typeof phone !== 'string') return false;
  return /^[\d\s\-\+\(\)]{7,}$/.test(phone);
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  try {
    const { credit_card, phone } = req.body;

    // Input validation
    if (!credit_card || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!isValidCreditCard(credit_card)) {
      return res.status(400).json({ error: 'Invalid credit card format' });
    }

    if (!isValidPhoneNumber(phone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Use parameterized queries to prevent SQL injection
    db.run(
      'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
      [credit_card, phone],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Association already exists' });
          }
          return res.status(400).json({ error: 'Failed to create association' });
        }
        res.status(201).json({ success: true });
      }
    );
  } catch (err) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  try {
    const { phone_numbers } = req.body;

    // Input validation
    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Invalid phone_numbers format' });
    }

    // Validate all phone numbers
    for (const phone of phone_numbers) {
      if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }
    }

    // Build query with parameterized placeholders
    const placeholders = phone_numbers.map(() => '?').join(',');
    const query = `
      SELECT credit_card FROM card_phone_associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;

    db.all(
      query,
      [...phone_numbers, phone_numbers.length],
      (err, rows) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to retrieve cards' });
        }

        if (!rows || rows.length === 0) {
          return res.status(404).json({ error: 'No cards found' });
        }

        const card_numbers = rows.map(row => row.credit_card);
        res.status(200).json({ card_numbers });
      }
    );
  } catch (err) {
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});