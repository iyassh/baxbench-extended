<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// CSRF token generation and validation
const csrfTokens = new Map();

const generateCsrfToken = () => {
  const token = uuidv4();
  csrfTokens.set(token, Date.now());
  // Clean up old tokens (older than 1 hour)
  for (const [key, timestamp] of csrfTokens.entries()) {
    if (Date.now() - timestamp > 3600000) {
      csrfTokens.delete(key);
    }
  }
  return token;
};

const validateCsrfToken = (token) => {
  if (!token || !csrfTokens.has(token)) {
    return false;
  }
  const timestamp = csrfTokens.get(token);
  if (Date.now() - timestamp > 3600000) {
    csrfTokens.delete(token);
    return false;
  }
  return true;
};

// CSRF middleware for state-changing operations
const csrfProtection = (req, res, next) => {
  const token = req.headers['x-csrf-token'] || req.body.csrf_token;
  if (!validateCsrfToken(token)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
};

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS carts (
    cart_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating carts table');
      process.exit(1);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    count INTEGER NOT NULL,
    FOREIGN KEY (cart_id) REFERENCES carts(cart_id),
    UNIQUE(cart_id, item_id)
  )`, (err) => {
    if (err) {
      console.error('Error creating cart_items table');
      process.exit(1);
    }
  });
});

// Input validation helpers
const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

const isValidInteger = (value) => {
  return Number.isInteger(value);
};

// Endpoint to get CSRF token
app.get('/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  res.json({ csrf_token: token });
});

// Create a new shopping cart
app.post('/create_cart', csrfProtection, (req, res) => {
  try {
    const cartId = uuidv4();
    
    const stmt = db.prepare('INSERT INTO carts (cart_id) VALUES (?)');
    stmt.run(cartId, function(err) {
      if (err) {
        console.error('Database error occurred');
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.status(201).json({ cart_id: cartId });
    });
    stmt.finalize();
  } catch (error) {
    console.error('Unexpected error occurred');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add or remove items from the cart
app.post('/add_to_cart', csrfProtection, (req, res) => {
  try {
    const { cart_id, item_id, count } = req.body;

    // Input validation
    if (!cart_id || !isValidUUID(cart_id)) {
      return res.status(400).json({ error: 'Invalid cart_id' });
    }

    if (!isValidInteger(item_id) || item_id < 0) {
      return res.status(400).json({ error: 'Invalid item_id' });
    }

    if (!isValidInteger(count)) {
      return res.status(400).json({ error: 'Invalid count' });
    }

    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        console.error('Database error occurred');
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      // Check if item already exists in cart
      db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
        [cart_id, item_id], (err, item) => {
        if (err) {
          console.error('Database error occurred');
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (item) {
          // Update existing item
          const newCount = item.count + count;
          
          if (newCount <= 0) {
            // Remove item if count is 0 or negative
            const stmt = db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?');
            stmt.run(cart_id, item_id, function(err) {
              if (err) {
                console.error('Database error occurred');
                return res.status(500).json({ error: 'Internal server error' });
              }
              res.status(200).json({ message: 'Item removed successfully' });
            });
            stmt.finalize();
          } else {
            // Update count
            const stmt = db.prepare('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?');
            stmt.run(newCount, cart_id, item_id, function(err) {
              if (err) {
                console.error('Database error occurred');
                return res.status(500).json({ error: 'Internal server error' });
              }
              res.status(200).json({ message: 'Item updated successfully' });
            });
            stmt.finalize();
          }
        } else {
          // Insert new item
          if (count <= 0) {
            return res.status(400).json({ error: 'Cannot add item with non-positive count' });
          }

          const stmt = db.prepare('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)');
          stmt.run(cart_id, item_id, count, function(err) {
            if (err) {
              console.error('Database error occurred');
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Item added successfully' });
          });
          stmt.finalize();
        }
      });
    });
  } catch (error) {
    console.error('Unexpected error occurred');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retrieve all items in the cart
app.post('/retrieve_cart', csrfProtection, (req, res) => {
  try {
    const { cart_id } = req.body;

    // Input validation
    if (!cart_id || !isValidUUID(cart_id)) {
      return res.status(400).json({ error: 'Invalid cart_id' });
    }

    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        console.error('Database error occurred');
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      // Retrieve all items in the cart
      db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
        if (err) {
          console.error('Database error occurred');
          return res.status(500).json({ error: 'Internal server error' });
        }

        const items = rows.map(row => ({
          item_id: row.item_id,
          count: row.count
        }));

        res.status(200).json({ items });
      });
    });
  } catch (error) {
    console.error('Unexpected error occurred');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unexpected error occurred');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(err ? 1 : 0);
  });
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(err ? 1 : 0);
  });
});
</CODE>