'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json());

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to database');
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

  db.run(`CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// Helper: run query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// POST /products - Create a product
app.post('/products', async (req, res) => {
  try {
    const { name, price } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid product name' });
    }

    if (price === undefined || price === null || typeof price !== 'number' || isNaN(price) || price < 0) {
      return res.status(400).json({ error: 'Invalid product price' });
    }

    const trimmedName = name.trim();
    const roundedPrice = Math.round(price * 100) / 100;

    const result = await dbRun(
      'INSERT INTO products (name, price) VALUES (?, ?)',
      [trimmedName, roundedPrice]
    );

    return res.status(201).json({
      id: result.lastID,
      name: trimmedName,
      price: roundedPrice
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products - List all products
app.get('/products', async (req, res) => {
  try {
    const products = await dbAll('SELECT id, name, price FROM products', []);
    return res.status(200).json(products);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', async (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    if (
      product_id === undefined ||
      product_id === null ||
      !Number.isInteger(product_id) ||
      product_id <= 0
    ) {
      return res.status(400).json({ error: 'Invalid product_id' });
    }

    if (
      quantity === undefined ||
      quantity === null ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    // Check product exists
    const product = await dbGet('SELECT id FROM products WHERE id = ?', [product_id]);
    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Check if product already in cart
    const existing = await dbGet('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id]);

    if (existing) {
      const newQuantity = existing.quantity + quantity;
      await dbRun('UPDATE cart SET quantity = ? WHERE id = ?', [newQuantity, existing.id]);
    } else {
      await dbRun('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', [product_id, quantity]);
    }

    return res.status(200).json({ message: 'Item added to cart' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /cart - Get cart contents
app.get('/cart', async (req, res) => {
  try {
    const items = await dbAll(
      `SELECT c.product_id, p.name, p.price, c.quantity
       FROM cart c
       JOIN products p ON c.product_id = p.id`,
      []
    );

    let total = 0;
    for (const item of items) {
      total += item.price * item.quantity;
    }
    total = Math.round(total * 100) / 100;

    return res.status(200).json({ items, total });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /checkout - Process checkout
app.post('/checkout', async (req, res) => {
  try {
    const items = await dbAll(
      `SELECT c.product_id, p.name, p.price, c.quantity
       FROM cart c
       JOIN products p ON c.product_id = p.id`,
      []
    );

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    let total = 0;
    for (const item of items) {
      if (item.price < 0 || item.quantity <= 0) {
        return res.status(400).json({ error: 'Invalid cart item' });
      }
      total += item.price * item.quantity;
    }
    total = Math.round(total * 100) / 100;

    if (total <= 0) {
      return res.status(400).json({ error: 'Order total must be greater than zero' });
    }

    // Clear the cart after successful checkout
    await dbRun('DELETE FROM cart', []);

    return res.status(200).json({ message: 'Order confirmed', total });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;