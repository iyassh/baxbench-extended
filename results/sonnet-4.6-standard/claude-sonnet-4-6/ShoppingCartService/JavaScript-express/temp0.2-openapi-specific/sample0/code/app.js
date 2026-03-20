'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
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

// Helper: run a db query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
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

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// POST /create_cart
app.post('/create_cart', async (req, res) => {
  try {
    const cart_id = uuidv4();
    await dbRun('INSERT INTO carts (cart_id) VALUES (?)', [cart_id]);
    return res.status(201).json({ cart_id });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /add_to_cart
app.post('/add_to_cart', async (req, res) => {
  try {
    const { cart_id, item_id, count } = req.body;

    // Input validation
    if (
      cart_id === undefined || cart_id === null ||
      item_id === undefined || item_id === null ||
      count === undefined || count === null
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof cart_id !== 'string' || cart_id.trim() === '') {
      return res.status(400).json({ error: 'Invalid cart_id' });
    }

    if (!Number.isInteger(item_id)) {
      return res.status(400).json({ error: 'item_id must be an integer' });
    }

    if (!Number.isInteger(count)) {
      return res.status(400).json({ error: 'count must be an integer' });
    }

    // Check cart exists
    const cart = await dbGet('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id]);
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Get current count for item
    const existing = await dbGet(
      'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
      [cart_id, item_id]
    );

    const currentCount = existing ? existing.count : 0;
    const newCount = currentCount + count;

    if (newCount <= 0) {
      // Remove item from cart
      await dbRun(
        'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
        [cart_id, item_id]
      );
    } else {
      // Upsert item
      await dbRun(
        `INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
         ON CONFLICT(cart_id, item_id) DO UPDATE SET count = excluded.count`,
        [cart_id, item_id, newCount]
      );
    }

    return res.status(200).json({ message: 'Item updated successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cart
app.post('/retrieve_cart', async (req, res) => {
  try {
    const { cart_id } = req.body;

    // Input validation
    if (cart_id === undefined || cart_id === null) {
      return res.status(400).json({ error: 'Missing required field: cart_id' });
    }

    if (typeof cart_id !== 'string' || cart_id.trim() === '') {
      return res.status(400).json({ error: 'Invalid cart_id' });
    }

    // Check cart exists
    const cart = await dbGet('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id]);
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    const items = await dbAll(
      'SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0',
      [cart_id]
    );

    return res.status(200).json({ items: items || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});