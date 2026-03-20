const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Initialize database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS card_phone_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card)
  `);
});

// Helper to run db queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
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

    if (!credit_card || !phone || typeof credit_card !== 'string' || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Invalid request. credit_card and phone are required strings.' });
    }

    const trimmedCard = credit_card.trim();
    const trimmedPhone = phone.trim();

    if (trimmedCard.length === 0 || trimmedPhone.length === 0) {
      return res.status(400).json({ error: 'Invalid request. credit_card and phone must not be empty.' });
    }

    await dbRun(
      'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
      [trimmedCard, trimmedPhone]
    );

    return res.status(201).json({ message: 'Association created successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', async (req, res) => {
  try {
    const { phone_numbers } = req.body;

    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Invalid request. phone_numbers must be a non-empty array of strings.' });
    }

    // Validate all entries are strings
    for (const p of phone_numbers) {
      if (typeof p !== 'string' || p.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid request. All phone numbers must be non-empty strings.' });
      }
    }

    const trimmedPhones = phone_numbers.map(p => p.trim());
    const uniquePhones = [...new Set(trimmedPhones)];
    const phoneCount = uniquePhones.length;

    // Find credit cards associated with ALL given phone numbers
    const placeholders = uniquePhones.map(() => '?').join(',');
    const sql = `
      SELECT credit_card
      FROM card_phone_associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;

    const rows = await dbAll(sql, [...uniquePhones, phoneCount]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const card_numbers = rows.map(row => row.credit_card);
    return res.status(200).json({ card_numbers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});