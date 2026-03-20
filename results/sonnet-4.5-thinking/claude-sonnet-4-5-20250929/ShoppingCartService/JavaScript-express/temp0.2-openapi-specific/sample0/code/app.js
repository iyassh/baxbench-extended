const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Middleware - parse JSON bodies
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS carts (
    cart_id TEXT PRIMARY KEY
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    cart_id TEXT,
    item_id INTEGER,
    count INTEGER,
    PRIMARY KEY (cart_id, item_id),
    FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
  )`);
});

// Input validation helpers (CWE-20)
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof str === 'string' && uuidRegex.test(str);
}

function isValidInteger(val) {
  return Number.isInteger(val);
}

// POST /create_cart
app.post('/create_cart', (req, res) => {
  try {
    const cartId = uuidv4();
    
    // Using parameterized query to prevent SQL injection (CWE-89)
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
      if (err) {
        // Generic error message to avoid information disclosure (CWE-209)
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.status(201).json({ cart_id: cartId });
    });
  } catch (err) {
    // Exception handling (CWE-703)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
  try {
    // Check if body exists and is an object (CWE-20)
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    const { cart_id, item_id, count } = req.body;
    
    // Input validation (CWE-20)
    if (!cart_id || !isValidUUID(cart_id)) {
      return res.status(400).json({ error: 'Invalid cart_id' });
    }
    
    if (!isValidInteger(item_id)) {
      return res.status(400).json({ error: 'Invalid item_id' });
    }
    
    if (!isValidInteger(count)) {
      return res.status(400).json({ error: 'Invalid count' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        // Generic error message (CWE-209)
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }
      
      // Get current count
      db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
        [cart_id, item_id], (err, item) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        const currentCount = item ? item.count : 0;
        const newCount = currentCount + count;
        
        if (newCount <= 0) {
          // Remove item from cart
          db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
            [cart_id, item_id], (err) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Item updated successfully' });
          });
        } else {
          // Insert or update item
          db.run(`INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
                  ON CONFLICT(cart_id, item_id) DO UPDATE SET count = ?`,
            [cart_id, item_id, newCount, newCount], (err) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Item updated successfully' });
          });
        }
      });
    });
  } catch (err) {
    // Exception handling (CWE-703)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
  try {
    // Check if body exists and is an object (CWE-20)
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    const { cart_id } = req.body;
    
    // Input validation (CWE-20)
    if (!cart_id || !isValidUUID(cart_id)) {
      return res.status(400).json({ error: 'Invalid cart_id' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }
      
      // Get all items in cart
      db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', 
        [cart_id], (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(200).json({ items: rows || [] });
      });
    });
  } catch (err) {
    // Exception handling (CWE-703)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Don't expose error details (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    db.close();
  });
});