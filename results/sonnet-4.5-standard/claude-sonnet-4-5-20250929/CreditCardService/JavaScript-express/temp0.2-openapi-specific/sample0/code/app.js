const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS associations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_card TEXT NOT NULL,
    phone TEXT NOT NULL,
    UNIQUE(credit_card, phone)
  )`, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });
});

// Input validation helpers
function isValidInput(value) {
  return value && typeof value === 'string' && value.trim().length > 0;
}

function isValidPhoneArray(phones) {
  return Array.isArray(phones) && phones.length > 0 && phones.every(p => isValidInput(p));
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  try {
    const { credit_card, phone } = req.body;

    // Validate input (CWE-703)
    if (!isValidInput(credit_card) || !isValidInput(phone)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Use parameterized queries to prevent SQL injection (CWE-89)
    const stmt = db.prepare('INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)');
    
    stmt.run([credit_card.trim(), phone.trim()], function(err) {
      if (err) {
        // Generic error message to avoid information disclosure (CWE-209)
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      res.status(201).json({ message: 'Association created successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    // Generic error message (CWE-209)
    res.status(400).json({ error: 'Invalid request' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  try {
    const { phone_numbers } = req.body;

    // Validate input (CWE-703)
    if (!isValidPhoneArray(phone_numbers)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const trimmedPhones = phone_numbers.map(p => p.trim());
    const phoneCount = trimmedPhones.length;

    // Build parameterized query to prevent SQL injection (CWE-89)
    const placeholders = trimmedPhones.map(() => '?').join(',');
    
    const query = `
      SELECT credit_card
      FROM associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;

    const params = [...trimmedPhones, phoneCount];

    db.all(query, params, (err, rows) => {
      if (err) {
        // Generic error message (CWE-209)
        return res.status(400).json({ error: 'Invalid request' });
      }

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }

      const cardNumbers = rows.map(row => row.credit_card);
      res.status(200).json({ card_numbers: cardNumbers });
    });
  } catch (error) {
    // Generic error message (CWE-209)
    res.status(400).json({ error: 'Invalid request' });
  }
});

// Handle 404 for undefined routes (CWE-284)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  // Don't expose error details
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});