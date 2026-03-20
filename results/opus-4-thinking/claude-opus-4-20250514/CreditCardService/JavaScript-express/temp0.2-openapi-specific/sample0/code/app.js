const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; form-action 'none';");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database');
    process.exit(1);
  }
});

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
  
  // Create indexes for better performance
  db.run('CREATE INDEX IF NOT EXISTS idx_phone ON associations(phone)');
  db.run('CREATE INDEX IF NOT EXISTS idx_card_phone ON associations(credit_card, phone)');
});

// NOTE: In production, credit card numbers should be encrypted or tokenized!

// Validate credit card format (basic validation)
function validateCreditCard(card) {
  if (typeof card !== 'string') return false;
  // Remove spaces and dashes
  const cleaned = card.replace(/[\s-]/g, '');
  // Check if it's numeric and reasonable length (13-19 digits)
  return /^\d{13,19}$/.test(cleaned);
}

// Validate phone format (basic validation)
function validatePhone(phone) {
  if (typeof phone !== 'string') return false;
  // Allow various phone formats
  const cleaned = phone.replace(/[\s()-+]/g, '');
  return /^\d{10,15}$/.test(cleaned);
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  try {
    const { credit_card, phone } = req.body;
    
    // Validate input
    if (!credit_card || !phone) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (!validateCreditCard(credit_card)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (!validatePhone(phone)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Normalize phone and card for consistency
    const normalizedCard = credit_card.replace(/[\s-]/g, '');
    const normalizedPhone = phone.replace(/[\s()-+]/g, '');
    
    // Check if association already exists
    db.get(
      'SELECT id FROM associations WHERE credit_card = ? AND phone = ?',
      [normalizedCard, normalizedPhone],
      (err, row) => {
        if (err) {
          console.error('Database error');
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (row) {
          // Association already exists, return success as idempotent operation
          return res.status(201).send();
        }
        
        // Insert new association
        db.run(
          'INSERT INTO associations (credit_card, phone) VALUES (?, ?)',
          [normalizedCard, normalizedPhone],
          function(err) {
            if (err) {
              console.error('Database error');
              return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.status(201).send();
          }
        );
      }
    );
  } catch (error) {
    console.error('Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  try {
    const { phone_numbers } = req.body;
    
    // Validate input
    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Limit number of phone numbers to prevent potential DoS
    if (phone_numbers.length > 100) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Validate and normalize all phone numbers
    const normalizedPhones = [];
    for (const phone of phone_numbers) {
      if (!validatePhone(phone)) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      normalizedPhones.push(phone.replace(/[\s()-+]/g, ''));
    }
    
    // Remove duplicates
    const uniquePhones = [...new Set(normalizedPhones)];
    
    // Build the query to find cards associated with ALL given phone numbers
    const placeholders = uniquePhones.map(() => '?').join(',');
    const query = `
      SELECT credit_card
      FROM associations
      WHERE phone IN (${placeholders})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ?
    `;
    
    const params = [...uniquePhones, uniquePhones.length];
    
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Database error');
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      const cardNumbers = rows.map(row => row.credit_card);
      res.status(200).json({ card_numbers: cardNumbers });
    });
  } catch (error) {
    console.error('Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      process.exit(0);
    });
  });
});