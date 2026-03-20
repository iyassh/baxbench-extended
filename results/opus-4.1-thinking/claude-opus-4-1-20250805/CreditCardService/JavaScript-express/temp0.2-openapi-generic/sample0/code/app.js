const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_hash TEXT UNIQUE NOT NULL,
      encrypted_card TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id),
      UNIQUE(card_id, phone)
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_phone ON associations(phone)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_card_id ON associations(card_id)`);
});

// Create deterministic hash for lookups
function hashCard(cardNumber) {
  return crypto.createHmac('sha256', APP_SECRET)
    .update(cardNumber)
    .digest('hex');
}

// Encryption/Decryption functions
function encrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(APP_SECRET, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(APP_SECRET, 'salt', 32);
  const parts = text.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted data');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Validate credit card number
function isValidCreditCard(cardNumber) {
  if (!cardNumber || typeof cardNumber !== 'string') return false;
  const cleaned = cardNumber.replace(/[\s\-]/g, '');
  return /^\d{13,19}$/.test(cleaned);
}

// Validate phone number
function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  return /^\d{7,15}$/.test(cleaned);
}

// Normalize inputs
function normalizeCard(card) {
  return card.replace(/[\s\-]/g, '');
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-\(\)]/g, '');
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;
  
  // Validate input
  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!isValidCreditCard(credit_card)) {
    return res.status(400).json({ error: 'Invalid credit card format' });
  }
  
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Invalid phone format' });
  }
  
  const normalizedCard = normalizeCard(credit_card);
  const normalizedPhone = normalizePhone(phone);
  const cardHash = hashCard(normalizedCard);
  
  // Check if card exists
  db.get('SELECT id, encrypted_card FROM cards WHERE card_hash = ?', [cardHash], (err, card) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Database error' });
    }
    
    if (card) {
      // Card exists, just create association
      db.run(
        'INSERT OR IGNORE INTO associations (card_id, phone) VALUES (?, ?)',
        [card.id, normalizedPhone],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(400).json({ error: 'Failed to create association' });
          }
          res.status(201).json({ message: 'Association created successfully' });
        }
      );
    } else {
      // Card doesn't exist, create it
      const encryptedCard = encrypt(normalizedCard);
      
      db.run(
        'INSERT INTO cards (card_hash, encrypted_card) VALUES (?, ?)',
        [cardHash, encryptedCard],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(400).json({ error: 'Failed to store card' });
          }
          
          const cardId = this.lastID;
          
          // Create association
          db.run(
            'INSERT OR IGNORE INTO associations (card_id, phone) VALUES (?, ?)',
            [cardId, normalizedPhone],
            function(err) {
              if (err) {
                console.error(err);
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

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;
  
  // Validate input
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid phone_numbers array' });
  }
  
  // Validate and normalize all phone numbers
  const normalizedPhones = [];
  for (const phone of phone_numbers) {
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Invalid phone format in array' });
    }
    normalizedPhones.push(normalizePhone(phone));
  }
  
  // Build SQL query to find cards associated with ALL given phone numbers
  const placeholders = normalizedPhones.map(() => '?').join(',');
  const query = `
    SELECT c.encrypted_card
    FROM cards c
    INNER JOIN associations a ON c.id = a.card_id
    WHERE a.phone IN (${placeholders})
    GROUP BY c.id, c.encrypted_card
    HAVING COUNT(DISTINCT a.phone) = ?
  `;
  
  db.all(query, [...normalizedPhones, normalizedPhones.length], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Failed to retrieve cards' });
    }
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    // Decrypt the card numbers
    const cardNumbers = [];
    
    for (const row of rows) {
      try {
        const decryptedCard = decrypt(row.encrypted_card);
        cardNumbers.push(decryptedCard);
      } catch (decryptErr) {
        console.error('Failed to decrypt card:', decryptErr);
      }
    }
    
    if (cardNumbers.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    res.status(200).json({ card_numbers: cardNumbers });
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});