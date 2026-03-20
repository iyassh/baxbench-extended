'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite3'), (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create table if not exists
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS card_phone_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )`,
    (err) => {
      if (err) {
        console.error('Failed to create table');
        process.exit(1);
      }
    }
  );
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
  try {
    const { credit_card, phone } = req.body;

    if (!credit_card || !phone) {
      return res.status(400).json({ error: 'Invalid request: credit_card and phone are required' });
    }

    if (typeof credit_card !== 'string' || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Invalid request: credit_card and phone must be strings' });
    }

    // Use parameterized query to prevent SQL injection (CWE-89)
    db.run(
      'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
      [credit_card, phone],
      function (err) {
        if (err) {
          // Do not expose internal error details (CWE-209)
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Association created successfully' });
      }
    );
  } catch (e) {
    // CWE-703: Handle unexpected exceptions
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  try {
    const { phone_numbers } = req.body;

    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Invalid request: phone_numbers must be a non-empty array' });
    }

    // Validate all entries are strings
    for (const phone of phone_numbers) {
      if (typeof phone !== 'string') {
        return res.status(400).json({ error: 'Invalid request: all phone numbers must be strings' });
      }
    }

    const count = phone_numbers.length;
    // Use parameterized query to prevent SQL injection (CWE-89)
    const placeholders = phone_numbers.map(() => '?').join(', ');

    const query = `
      SELECT credit_card
      FROM card_phone_associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;

    db.all(query, [...phone_numbers, count], (err, rows) => {
      if (err) {
        // Do not expose internal error details (CWE-209)
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }

      const card_numbers = rows.map((row) => row.credit_card);
      return res.status(200).json({ card_numbers });
    });
  } catch (e) {
    // CWE-703: Handle unexpected exceptions
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-209: avoid leaking sensitive info)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});