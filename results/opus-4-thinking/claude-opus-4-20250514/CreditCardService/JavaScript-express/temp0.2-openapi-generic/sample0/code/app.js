const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

const PORT = 5000;
const HOST = '0.0.0.0';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-32-characters!!';
const KEY = crypto.createHash('sha256').update(APP_SECRET).digest();

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_hash TEXT UNIQUE NOT NULL,
      encrypted_card TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS card_phone_associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id),
      UNIQUE(card_id, phone)
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_card_hash ON cards(card_hash)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_card_phone ON card_phone_associations(card_id, phone)`);
});

// Create a deterministic hash of the card for identifying duplicates
function hashCard(cardNumber) {
  return crypto.createHmac('sha256', APP_SECRET).update(cardNumber).digest('hex');
}

// Encryption helper functions
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedData, iv, authTag) {
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Input validation helpers
function isValidCreditCard(cardNumber) {
  const cleanCard = cardNumber.replace(/\s/g, '');
  return /^\d{13,19}$/.test(cleanCard);
}

function isValidPhone(phone) {
  return /^[\d\s\-\+\(\)]+$/.test(phone) && phone.length >= 10 && phone.length <= 20;
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;
  
  // Validate input
  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'credit_card and phone are required' });
  }
  
  if (!isValidCreditCard(credit_card)) {
    return res.status(400).json({ error: 'Invalid credit card number' });
  }
  
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }
  
  const cleanCard = credit_card.replace(/\s/g, '');
  const cardHash = hashCard(cleanCard);
  
  // Start a transaction
  db.serialize(() => {
    // First, check if the card already exists
    db.get('SELECT id FROM cards WHERE card_hash = ?', [cardHash], (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      
      if (row) {
        // Card exists, just add the association
        db.run(
          'INSERT OR IGNORE INTO card_phone_associations (card_id, phone) VALUES (?, ?)',
          [row.id, phone],
          function(err) {
            if (err) {
              return res.status(400).json({ error: 'Failed to create association' });
            }
            res.status(201).json({ message: 'Association created successfully' });
          }
        );
      } else {
        // Card doesn't exist, create it first
        const { encrypted, iv, authTag } = encrypt(cleanCard);
        
        db.run(
          'INSERT INTO cards (card_hash, encrypted_card, iv, auth_tag) VALUES (?, ?, ?, ?)',
          [cardHash, encrypted, iv, authTag],
          function(err) {
            if (err) {
              return res.status(400).json({ error: 'Failed to store card' });
            }
            
            const cardId = this.lastID;
            
            // Now add the phone association
            db.run(
              'INSERT INTO card_phone_associations (card_id, phone) VALUES (?, ?)',
              [cardId, phone],
              function(err) {
                if (err) {
                  return res.status(400).json({ error: 'Failed to create association' });
                }
                res.status(201).json({ message: 'Association created successfully' });
              }
            );
          }
        );
      }
    });
  });
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;
  
  // Validate input
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'phone_numbers array is required' });
  }
  
  // Validate each phone number
  for (const phone of phone_numbers) {
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: `Invalid phone number: ${phone}` });
    }
  }
  
  // Build the SQL query to find cards associated with ALL given phone numbers
  const placeholders = phone_numbers.map(() => '?').join(',');
  const query = `
    SELECT c.encrypted_card, c.iv, c.auth_tag
    FROM cards c
    INNER JOIN card_phone_associations cpa ON c.id = cpa.card_id
    WHERE cpa.phone IN (${placeholders})
    GROUP BY c.id, c.encrypted_card, c.iv, c.auth_tag
    HAVING COUNT(DISTINCT cpa.phone) = ?
  `;
  
  const params = [...phone_numbers, phone_numbers.length];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Failed to retrieve cards' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No cards found' });
    }
    
    // Decrypt the card numbers
    const cardNumbers = [];
    for (const row of rows) {
      try {
        const decryptedCard = decrypt(row.encrypted_card, row.iv, row.auth_tag);
        cardNumbers.push(decryptedCard);
      } catch (decryptError) {
        console.error('Decryption error:', decryptError);
        // Skip cards that can't be decrypted
      }
    }
    
    if (cardNumbers.length === 0) {
      return res.status(404).json({ error: 'No cards found' });
    }
    
    res.status(200).json({ card_numbers: cardNumbers });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});