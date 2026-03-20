const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  // Create carts table
  db.run(`
    CREATE TABLE IF NOT EXISTS carts (
      cart_id TEXT PRIMARY KEY
    )
  `);
  
  // Create cart_items table
  db.run(`
    CREATE TABLE IF NOT EXISTS cart_items (
      cart_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (cart_id, item_id),
      FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    )
  `);
});

// POST /create_cart
app.post('/create_cart', (req, res) => {
  const cartId = uuidv4();
  
  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create cart' });
    }
    
    res.status(201).json({ cart_id: cartId });
  });
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;
  
  // Validate input
  if (!cart_id || item_id === undefined || count === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (typeof cart_id !== 'string' || typeof item_id !== 'number' || typeof count !== 'number') {
    return res.status(400).json({ error: 'Invalid field types' });
  }
  
  if (!Number.isInteger(item_id) || !Number.isInteger(count)) {
    return res.status(400).json({ error: 'item_id and count must be integers' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Get current count for this item
    db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
      [cart_id, item_id], (err, itemRow) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      const currentCount = itemRow ? itemRow.count : 0;
      const newCount = currentCount + count;
      
      if (newCount <= 0) {
        // Remove item from cart
        db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
          [cart_id, item_id], (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to remove item' });
          }
          res.status(200).send();
        });
      } else {
        // Insert or update item
        db.run(`
          INSERT INTO cart_items (cart_id, item_id, count) 
          VALUES (?, ?, ?)
          ON CONFLICT(cart_id, item_id) 
          DO UPDATE SET count = ?
        `, [cart_id, item_id, newCount, newCount], (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to update cart' });
          }
          res.status(200).send();
        });
      }
    });
  });
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;
  
  // Validate input
  if (!cart_id) {
    return res.status(400).json({ error: 'Missing cart_id' });
  }
  
  if (typeof cart_id !== 'string') {
    return res.status(400).json({ error: 'Invalid cart_id type' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Get all items in the cart
    db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to retrieve cart items' });
      }
      
      res.status(200).json({ items: rows || [] });
    });
  });
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
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
  console.log('Shutting down server...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error(err.message);
      }
      console.log('Database connection closed.');
      process.exit(0);
    });
  });
});