const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
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

// POST /create_cart - Create a new shopping cart
app.post('/create_cart', (req, res) => {
  const cartId = uuidv4();

  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], (err) => {
    if (err) {
      // CWE-209: Don't expose internal error details
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(201).json({ cart_id: cartId });
  });
});

// POST /add_to_cart - Add or remove items from the cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;

  // CWE-20: Input validation
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

  // Check if cart exists (CWE-89: using parameterized queries)
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
          db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            return res.status(200).json({ message: 'Item removed from cart' });
          });
        } else {
          // Update count
          db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', [newCount, cart_id, item_id], (err) => {
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
        db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', [cart_id, item_id, count], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Internal server error' });
          }
          return res.status(200).json({ message: 'Item added to cart' });
        });
      }
    });
  });
});

// POST /retrieve_cart - Retrieve all items in the cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;

  // CWE-20: Input validation
  if (cart_id === undefined) {
    return res.status(400).json({ error: 'Missing required field: cart_id' });
  }

  if (typeof cart_id !== 'string' || cart_id.trim() === '') {
    return res.status(400).json({ error: 'cart_id must be a non-empty string' });
  }

  // Check if cart exists (CWE-89: using parameterized queries)
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
});

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Shopping Cart Service running on http://0.0.0.0:5000');
});