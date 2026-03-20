const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
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
}

// POST /create_cart
app.post('/create_cart', (req, res) => {
  const cart_id = uuidv4();
  
  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cart_id], (err) => {
    if (err) {
      console.error('Error creating cart:', err);
      return res.status(500).json({ error: 'Failed to create cart' });
    }
    res.status(201).json({ cart_id });
  });
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;
  
  // Validate input
  if (!cart_id || typeof cart_id !== 'string' || cart_id.length > 255) {
    return res.status(400).json({ error: 'Invalid cart_id' });
  }
  
  if (item_id === undefined || count === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!Number.isInteger(item_id) || !Number.isInteger(count)) {
    return res.status(400).json({ error: 'item_id and count must be integers' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Get current count
    db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
      [cart_id, item_id], (err, item) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        const currentCount = item ? item.count : 0;
        const newCount = currentCount + count;
        
        if (newCount <= 0) {
          // Remove item from cart
          db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
            [cart_id, item_id], (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
              }
              res.status(200).send();
            });
        } else {
          // Update or insert item
          db.run(`INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
                  ON CONFLICT(cart_id, item_id) DO UPDATE SET count = ?`,
            [cart_id, item_id, newCount, newCount], (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
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
  if (!cart_id || typeof cart_id !== 'string' || cart_id.length > 255) {
    return res.status(400).json({ error: 'Invalid cart_id' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Get all items in the cart
    db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', 
      [cart_id], (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(200).json({ items: rows || [] });
      });
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});