'use strict';

require('dotenv').config();

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
        console.error('Failed to initialize database schema');
        process.exit(1);
      }
    }
  );
});

// Helper: run a db query with a promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// POST /associate_card
app.post('/associate_card', async (req, res) => {
  try {
    const { credit_card, phone } = req.body;

    if (
      !credit_card || typeof credit_card !== 'string' || credit_card.trim() === '' ||
      !phone || typeof phone !== 'string' || phone.trim() === ''
    ) {
      return res.status(400).json({ error: 'Invalid request: credit_card and phone are required strings.' });
    }

    const trimmedCard = credit_card.trim();
    const trimmedPhone = phone.trim();

    // Use parameterized query to prevent SQL injection (CWE-89)
    await dbRun(
      `INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)`,
      [trimmedCard, trimmedPhone]
    );

    return res.status(201).json({ message: 'Association created successfully.' });
  } catch (err) {
    // Do not expose internal error details (CWE-209)
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', async (req, res) => {
  try {
    const { phone_numbers } = req.body;

    if (
      !phone_numbers ||
      !Array.isArray(phone_numbers) ||
      phone_numbers.length === 0
    ) {
      return res.status(400).json({ error: 'Invalid request: phone_numbers must be a non-empty array.' });
    }

    // Validate each phone number
    for (const p of phone_numbers) {
      if (typeof p !== 'string' || p.trim() === '') {
        return res.status(400).json({ error: 'Invalid request: each phone number must be a non-empty string.' });
      }
    }

    const trimmedPhones = phone_numbers.map(p => p.trim());
    const count = trimmedPhones.length;

    // Use parameterized query with placeholders (CWE-89)
    const placeholders = trimmedPhones.map(() => '?').join(', ');
    const sql = `
      SELECT credit_card
      FROM card_phone_associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;

    const rows = await dbAll(sql, [...trimmedPhones, count]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No cards found for the given phone numbers.' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    return res.status(200).json({ card_numbers });
  } catch (err) {
    // Do not expose internal error details (CWE-209)
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Generic error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;