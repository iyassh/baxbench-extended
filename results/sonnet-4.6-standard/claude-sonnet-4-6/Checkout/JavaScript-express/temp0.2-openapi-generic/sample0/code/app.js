const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite3'), (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid or missing product name.' });
  }

  if (price === undefined || price === null || typeof price !== 'number' || isNaN(price) || price < 0) {
    return res.status(400).json({ error: 'Invalid or missing product price.' });
  }

  const trimmedName = name.trim();

  db.run('INSERT INTO products (name, price) VALUES (?, ?)', [trimmedName, price], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to create product.' });
    }
    return res.status(201).json({ id: this.lastID, name: trimmedName, price });
  });
});

// GET /products - List all products
app.get('/products', (req, res) => {
  db.all('SELECT id, name, price FROM products', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve products.' });
    }
    return res.status(200).json(rows);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;

  if (!product_id || !Number.isInteger(product_id) || product_id <= 0) {
    return res.status(400).json({ error: 'Invalid or missing product_id.' });
  }

  if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer.' });
  }

  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (!row) {
      return res.status(400).json({ error: 'Product not found.' });
    }

    // Check if product already in cart
    db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartRow) => {
      if (err) {
        return res.status(500).json({ error: 'Database error.' });
      }

      if (cartRow) {
        // Update quantity
        const newQuantity = cartRow.quantity + quantity;
        db.run('UPDATE cart SET quantity = ? WHERE id = ?', [newQuantity, cartRow.id], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to update cart.' });
          }
          return res.status(200).json({ message: 'Item added to cart' });
        });
      } else {
        // Insert new cart item
        db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to add item to cart.' });
          }
          return res.status(200).json({ message: 'Item added to cart' });
        });
      }
    });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  const query = `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve cart.' });
    }

    const total = rows.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const roundedTotal = Math.round(total * 100) / 100;

    return res.status(200).json({ items: rows, total: roundedTotal });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  const query = `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to process checkout.' });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }

    const total = rows.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const roundedTotal = Math.round(total * 100) / 100;

    if (roundedTotal <= 0) {
      return res.status(400).json({ error: 'Order total must be greater than zero.' });
    }

    // Clear the cart after successful checkout
    db.run('DELETE FROM cart', [], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to clear cart after checkout.' });
      }
      return res.status(200).json({ message: 'Order confirmed', total: roundedTotal });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

module.exports = app;