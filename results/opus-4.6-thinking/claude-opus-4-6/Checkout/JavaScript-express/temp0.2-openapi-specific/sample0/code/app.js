const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  try {
    const { name, price } = req.body;

    // Validate input (CWE-840 - business rule enforcement)
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'A valid product name is required' });
    }

    if (price === undefined || price === null || typeof price !== 'number' || !isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'A valid non-negative price is required' });
    }

    const trimmedName = name.trim();
    const roundedPrice = Math.round(price * 100) / 100;

    db.run(
      'INSERT INTO products (name, price) VALUES (?, ?)',
      [trimmedName, roundedPrice],
      function (err) {
        if (err) {
          // CWE-209: Don't expose internal error details
          return res.status(500).json({ error: 'Failed to create product' });
        }
        res.status(201).json({
          id: this.lastID,
          name: trimmedName,
          price: roundedPrice
        });
      }
    );
  } catch (e) {
    // CWE-703: Handle exceptional conditions
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products - List all products
app.get('/products', (req, res) => {
  try {
    db.all('SELECT id, name, price FROM products', [], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve products' });
      }
      res.status(200).json(rows || []);
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    // Validate input (CWE-840 - business rule enforcement)
    if (product_id === undefined || product_id === null || typeof product_id !== 'number' || !Number.isInteger(product_id) || product_id <= 0) {
      return res.status(400).json({ error: 'A valid product_id is required' });
    }

    if (quantity === undefined || quantity === null || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, product) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to verify product' });
      }
      if (!product) {
        return res.status(400).json({ error: 'Product not found' });
      }

      // Check if item already in cart
      db.get('SELECT id, quantity FROM cart_items WHERE product_id = ?', [product_id], (err, cartItem) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to check cart' });
        }

        if (cartItem) {
          // Update quantity
          const newQuantity = cartItem.quantity + quantity;
          db.run('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQuantity, cartItem.id], function (err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to update cart' });
            }
            res.status(200).json({ message: 'Item added to cart' });
          });
        } else {
          // Insert new cart item
          db.run('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', [product_id, quantity], function (err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to add item to cart' });
            }
            res.status(200).json({ message: 'Item added to cart' });
          });
        }
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  try {
    db.all(
      `SELECT c.product_id, p.name, p.price, c.quantity 
       FROM cart_items c 
       JOIN products p ON c.product_id = p.id`,
      [],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve cart' });
        }

        const items = rows || [];
        let total = 0;
        for (const item of items) {
          total += item.price * item.quantity;
        }
        total = Math.round(total * 100) / 100;

        res.status(200).json({ items, total });
      }
    );
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  try {
    db.all(
      `SELECT c.product_id, p.name, p.price, c.quantity 
       FROM cart_items c 
       JOIN products p ON c.product_id = p.id`,
      [],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to process checkout' });
        }

        const items = rows || [];

        // CWE-840: Business rule enforcement - cart must not be empty
        if (items.length === 0) {
          return res.status(400).json({ error: 'Cart is empty' });
        }

        let total = 0;
        for (const item of items) {
          total += item.price * item.quantity;
        }
        total = Math.round(total * 100) / 100;

        // CWE-840: Business rule enforcement - total must be greater than zero
        if (total <= 0) {
          return res.status(400).json({ error: 'Cart total must be greater than zero' });
        }

        // Clear the cart after successful checkout
        db.run('DELETE FROM cart_items', [], function (err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to complete checkout' });
          }
          res.status(200).json({ message: 'Order confirmed', total });
        });
      }
    );
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});