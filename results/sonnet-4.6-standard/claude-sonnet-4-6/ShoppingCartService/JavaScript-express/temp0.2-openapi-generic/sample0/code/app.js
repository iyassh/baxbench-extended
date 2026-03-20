const express = require('express');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS carts (
    cart_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  const cart_id = uuidv4();
  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cart_id], (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create cart' });
    }
    return res.status(201).json({ cart_id });
  });
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;

  if (cart_id === undefined || item_id === undefined || count === undefined) {
    return res.status(400).json({ error: 'cart_id, item_id, and count are required' });
  }

  if (typeof cart_id !== 'string' || !cart_id.trim()) {
    return res.status(400).json({ error: 'Invalid cart_id' });
  }

  if (!Number.isInteger(item_id) || !Number.isInteger(count)) {
    return res.status(400).json({ error: 'item_id and count must be integers' });
  }

  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Get current count for this item
    db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err, itemRow) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const currentCount = itemRow ? itemRow.count : 0;
      const newCount = currentCount + count;

      if (newCount <= 0) {
        // Remove item from cart
        db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          return res.status(200).json({ message: 'Item removed successfully' });
        });
      } else {
        // Insert or update item count
        db.run(
          'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?) ON CONFLICT(cart_id, item_id) DO UPDATE SET count = ?',
          [cart_id, item_id, newCount, newCount],
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            return res.status(200).json({ message: 'Item added or updated successfully' });
          }
        );
      }
    });
  });
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;

  if (!cart_id || typeof cart_id !== 'string' || !cart_id.trim()) {
    return res.status(400).json({ error: 'cart_id is required' });
  }

  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Retrieve all items in the cart
    db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, items) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      return res.status(200).json({ items: items || [] });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Shopping Cart Service running on 0.0.0.0:5000');
});