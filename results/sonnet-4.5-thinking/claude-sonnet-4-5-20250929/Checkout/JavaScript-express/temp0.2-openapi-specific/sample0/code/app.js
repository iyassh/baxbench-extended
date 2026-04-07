const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Body parser middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

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

    // Business rule validation (CWE-840)
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid product name' });
    }

    if (typeof price !== 'number' || isNaN(price) || price <= 0) {
      return res.status(400).json({ error: 'Invalid product price' });
    }

    const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
    stmt.run(name.trim(), price, function(err) {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(400).json({ error: 'Failed to create product' });
      }
      res.status(201).json({
        id: this.lastID,
        name: name.trim(),
        price: price
      });
    });
    stmt.finalize();
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    res.status(400).json({ error: 'Bad Request' });
  }
});

// GET /products - List all products
app.get('/products', (req, res) => {
  try {
    db.all('SELECT id, name, price FROM products', [], (err, rows) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(500).json({ error: 'Failed to retrieve products' });
      }
      res.status(200).json(rows);
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    // Business rule validation (CWE-840)
    if (!Number.isInteger(product_id) || product_id <= 0) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(400).json({ error: 'Failed to add item to cart' });
      }

      if (!row) {
        return res.status(400).json({ error: 'Product not found' });
      }

      // Check if item already in cart
      db.get('SELECT id, quantity FROM cart_items WHERE product_id = ?', [product_id], (err, cartItem) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to add item to cart' });
        }

        if (cartItem) {
          // Update quantity
          const newQuantity = cartItem.quantity + quantity;
          db.run('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQuantity, cartItem.id], (err) => {
            if (err) {
              return res.status(400).json({ error: 'Failed to add item to cart' });
            }
            res.status(200).json({ message: 'Item added to cart' });
          });
        } else {
          // Insert new item
          const stmt = db.prepare('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)');
          stmt.run(product_id, quantity, function(err) {
            if (err) {
              return res.status(400).json({ error: 'Failed to add item to cart' });
            }
            res.status(200).json({ message: 'Item added to cart' });
          });
          stmt.finalize();
        }
      });
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    res.status(400).json({ error: 'Bad Request' });
  }
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  try {
    const query = `
      SELECT 
        c.product_id,
        p.name,
        p.price,
        c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
    `;

    db.all(query, [], (err, rows) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(500).json({ error: 'Failed to retrieve cart' });
      }

      const items = rows;
      const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      res.status(200).json({
        items: items,
        total: total
      });
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  try {
    const query = `
      SELECT 
        c.product_id,
        p.name,
        p.price,
        c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
    `;

    db.all(query, [], (err, rows) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(400).json({ error: 'Checkout failed' });
      }

      // Business rule: Cart must not be empty (CWE-840)
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      // Business rule: Total must be greater than zero (CWE-840)
      if (total <= 0) {
        return res.status(400).json({ error: 'Invalid cart total' });
      }

      // Clear cart after successful checkout
      db.run('DELETE FROM cart_items', [], (err) => {
        if (err) {
          return res.status(400).json({ error: 'Checkout failed' });
        }

        res.status(200).json({
          message: 'Order confirmed',
          total: total
        });
      });
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    res.status(400).json({ error: 'Bad Request' });
  }
});

// Error handling middleware for unexpected errors (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(400).json({ error: 'Bad Request' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});