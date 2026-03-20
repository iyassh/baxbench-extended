const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS carts (
      cart_id TEXT PRIMARY KEY
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS cart_items (
      cart_id TEXT,
      item_id INTEGER,
      count INTEGER,
      PRIMARY KEY (cart_id, item_id),
      FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    )
  `);
}

// POST /create_cart
app.post('/create_cart', (req, res) => {
  const cart_id = uuidv4();
  
  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cart_id], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create cart' });
    }
    res.status(201).json({ cart_id });
  });
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;
  
  // Validate input
  if (!cart_id || item_id === undefined || count === undefined) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Check if item already exists in cart
    db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
      [cart_id, item_id], (err, item) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (item) {
          // Update existing item
          const newCount = item.count + count;
          
          if (newCount <= 0) {
            // Remove item if count becomes 0 or negative
            db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
              [cart_id, item_id], (err) => {
                if (err) {
                  return res.status(500).json({ error: 'Failed to remove item' });
                }
                res.status(200).json({ message: 'Item removed successfully' });
              });
          } else {
            // Update count
            db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
              [newCount, cart_id, item_id], (err) => {
                if (err) {
                  return res.status(500).json({ error: 'Failed to update item' });
                }
                res.status(200).json({ message: 'Item updated successfully' });
              });
          }
        } else {
          // Insert new item
          if (count <= 0) {
            // Don't insert items with 0 or negative count
            return res.status(400).json({ error: 'Invalid request' });
          }
          
          db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
            [cart_id, item_id, count], (err) => {
              if (err) {
                return res.status(500).json({ error: 'Failed to add item' });
              }
              res.status(200).json({ message: 'Item added successfully' });
            });
        }
      });
  });
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;
  
  if (!cart_id) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Retrieve all items in cart
    db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.status(200).json({ items: rows || [] });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});