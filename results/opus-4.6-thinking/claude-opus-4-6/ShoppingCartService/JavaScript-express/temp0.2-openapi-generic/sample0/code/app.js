const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

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

// Create a new shopping cart
app.post('/create_cart', (req, res) => {
  const cart_id = uuidv4();
  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cart_id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to create cart' });
    }
    res.status(201).json({ cart_id });
  });
});

// Add or remove items from the cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;

  if (cart_id === undefined || item_id === undefined || count === undefined) {
    return res.status(400).json({ error: 'Missing required fields: cart_id, item_id, count' });
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

    // Check if item already exists in cart
    db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err, itemRow) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (itemRow) {
        const newCount = itemRow.count + count;
        if (newCount <= 0) {
          // Remove the item from the cart
          db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], function (err) {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.status(200).json({ message: 'Item removed from cart' });
          });
        } else {
          db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', [newCount, cart_id, item_id], function (err) {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.status(200).json({ message: 'Item count updated' });
          });
        }
      } else {
        if (count <= 0) {
          return res.status(400).json({ error: 'Cannot add non-positive count for a new item' });
        }
        db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', [cart_id, item_id, count], function (err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      }
    });
  });
});

// Retrieve all items in the cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;

  if (cart_id === undefined) {
    return res.status(400).json({ error: 'Missing required field: cart_id' });
  }

  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(200).json({ items: rows || [] });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Shopping Cart Service running on http://0.0.0.0:5000');
});