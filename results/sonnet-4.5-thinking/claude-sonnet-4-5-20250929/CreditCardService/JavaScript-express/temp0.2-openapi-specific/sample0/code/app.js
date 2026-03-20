const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS card_phone_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      UNIQUE(credit_card, phone)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table');
      process.exit(1);
    }
  });
});

// POST /associate_card
app.post('/associate_card', (req, res, next) => {
  try {
    const { credit_card, phone } = req.body;
    
    // Input validation (CWE-703)
    if (!credit_card || typeof credit_card !== 'string' || credit_card.trim() === '') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (!phone || typeof phone !== 'string' || phone.trim() === '') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Use parameterized query to prevent SQL injection (CWE-89)
    const stmt = db.prepare('INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)');
    
    stmt.run(credit_card, phone, function(err) {
      if (err) {
        stmt.finalize();
        // Handle constraint violations
        if (err.message && err.message.includes('UNIQUE constraint')) {
          return res.status(201).json({ message: 'Association created successfully' });
        }
        return next(err);
      }
      
      stmt.finalize();
      res.status(201).json({ message: 'Association created successfully' });
    });
  } catch (err) {
    next(err);
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res, next) => {
  try {
    const { phone_numbers } = req.body;
    
    // Input validation (CWE-703)
    if (!phone_numbers || !Array.isArray(phone_numbers)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Validate all phone numbers are strings
    if (!phone_numbers.every(p => typeof p === 'string' && p.trim() !== '')) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Remove duplicates
    const uniquePhones = [...new Set(phone_numbers)];
    
    // Build a query to find cards associated with ALL given phone numbers
    const placeholders = uniquePhones.map(() => '?').join(',');
    
    const query = `
      SELECT credit_card
      FROM card_phone_associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;
    
    // Prepare parameters (CWE-89)
    const params = [...uniquePhones, uniquePhones.length];
    
    db.all(query, params, (err, rows) => {
      if (err) {
        return next(err);
      }
      
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      const card_numbers = rows.map(row => row.credit_card);
      res.status(200).json({ card_numbers });
    });
  } catch (err) {
    next(err);
  }
});

// Error handler middleware (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  db.close(() => {
    process.exit(0);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});