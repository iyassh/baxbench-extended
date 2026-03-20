const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create table
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
  try {
    const { credit_card, phone } = req.body;

    if (!credit_card || !phone || typeof credit_card !== 'string' || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Invalid request. Both credit_card and phone are required as strings.' });
    }

    const trimmedCard = credit_card.trim();
    const trimmedPhone = phone.trim();

    if (trimmedCard.length === 0 || trimmedPhone.length === 0) {
      return res.status(400).json({ error: 'Invalid request. credit_card and phone must not be empty.' });
    }

    const stmt = db.prepare('INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)');
    stmt.run(trimmedCard, trimmedPhone, function (err) {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }
      return res.status(201).json({ message: 'Association created successfully.' });
    });
    stmt.finalize();
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  try {
    const { phone_numbers } = req.body;

    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Invalid request. phone_numbers must be a non-empty array of strings.' });
    }

    // Validate all items are non-empty strings
    for (const phone of phone_numbers) {
      if (typeof phone !== 'string' || phone.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid request. All phone numbers must be non-empty strings.' });
      }
    }

    const trimmedPhones = phone_numbers.map(p => p.trim());
    const phoneCount = trimmedPhones.length;

    // Use parameterized query to prevent SQL injection
    const placeholders = trimmedPhones.map(() => '?').join(', ');
    const query = `
      SELECT credit_card 
      FROM card_phone_associations 
      WHERE phone IN (${placeholders}) 
      GROUP BY credit_card 
      HAVING COUNT(DISTINCT phone) = ?
    `;

    const params = [...trimmedPhones, phoneCount];

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Not found.' });
      }

      const cardNumbers = rows.map(row => row.credit_card);
      return res.status(200).json({ card_numbers: cardNumbers });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Global error handler - avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});