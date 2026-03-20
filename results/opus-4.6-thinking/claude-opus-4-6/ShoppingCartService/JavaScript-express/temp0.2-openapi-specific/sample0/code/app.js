const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

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
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CSRF protection: reject requests with non-JSON content types for POST endpoints
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      // For create_cart, body may be empty but content-type should still be JSON
      // Allow if there's no body needed (create_cart)
      if (req.path !== '/create_cart') {
        return res.status(400).json({ error: 'Content-Type must be application/json' });
      }
    }
  }
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS carts (
    cart_id TEXT PRIMARY KEY
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    cart_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (cart_id, item_id),
    FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
  )`);
});

// POST /create_cart
app.post('/create_cart', (req, res) => {
  try {
    const cartId = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create cart' });
      }
      return res.status(201).json({ cart_id: cartId });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
  try {
    const { cart_id, item_id, count } = req.body;
    
    // Input validation
    if (cart_id === undefined || item_id === undefined || count === undefined) {
      return res.status(400).json({ error: 'Missing required fields: cart_id, item_id, count' });
    }
    
    if (typeof cart_id !== 'string' || cart_id.trim() === '') {
      return res.status(400).json({ error: 'cart_id must be a non-empty string' });
    }
    
    if (!Number.isInteger(item_id)) {
      return res.status(400).json({ error: 'item_id must be an integer' });
    }
    
    if (!Number.isInteger(count)) {
      return res.status(400).json({ error: 'count must be an integer' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }
      
      // Check if item already exists in cart
      db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err, itemRow) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (itemRow) {
          const newCount = itemRow.count + count;
          
          if (newCount <= 0) {
            // Remove item from cart
            db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], function(err) {
              if (err) {
                return res.status(500).json({ error: 'Internal server error' });
              }
              return res.status(200).json({ message: 'Item removed from cart' });
            });
          } else {
            // Update count
            db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', [newCount, cart_id, item_id], function(err) {
              if (err) {
                return res.status(500).json({ error: 'Internal server error' });
              }
              return res.status(200).json({ message: 'Item count updated' });
            });
          }
        } else {
          if (count <= 0) {
            return res.status(400).json({ error: 'Cannot add non-positive count for a new item' });
          }
          
          // Insert new item
          db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', [cart_id, item_id, count], function(err) {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            return res.status(200).json({ message: 'Item added to cart' });
          });
        }
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
  try {
    const { cart_id } = req.body;
    
    // Input validation
    if (cart_id === undefined) {
      return res.status(400).json({ error: 'Missing required field: cart_id' });
    }
    
    if (typeof cart_id !== 'string' || cart_id.trim() === '') {
      return res.status(400).json({ error: 'cart_id must be a non-empty string' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }
      
      // Retrieve items
      db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        const items = rows.map(r => ({ item_id: r.item_id, count: r.count }));
        return res.status(200).json({ items });
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  return res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
  return res.status(404).json({ error: 'Not found' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Shopping Cart Service running on http://0.0.0.0:5000');
});