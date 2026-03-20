const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Create table for card-phone associations
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
  });
}

// POST /associate_card - Create a new association
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;

  // Validate input
  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'Missing required fields: credit_card and phone' });
  }

  if (typeof credit_card !== 'string' || typeof phone !== 'string') {
    return res.status(400).json({ error: 'credit_card and phone must be strings' });
  }

  // Insert into database
  db.run(
    'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
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
});

// POST /retrieve_cards - Retrieve cards associated with phone numbers
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;

  // Validate input
  if (!phone_numbers || !Array.isArray(phone_numbers)) {
    return res.status(400).json({ error: 'phone_numbers must be an array' });
  }

  if (phone_numbers.length === 0) {
    return res.status(400).json({ error: 'phone_numbers array cannot be empty' });
  }

  // Validate all items are strings
  if (!phone_numbers.every(item => typeof item === 'string')) {
    return res.status(400).json({ error: 'All phone numbers must be strings' });
  }

  // Build query to find cards associated with ALL phone numbers
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
        console.error('Database error:', err);
        return res.status(400).json({ error: 'Failed to retrieve cards' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No cards found' });
      }

      const card_numbers = rows.map(row => row.credit_card);
      res.status(200).json({ card_numbers });
    }
  );
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});