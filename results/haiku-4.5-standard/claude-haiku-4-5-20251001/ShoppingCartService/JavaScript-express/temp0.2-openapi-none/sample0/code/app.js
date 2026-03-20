const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cart_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id),
        UNIQUE(cart_id, item_id)
      )
    `);
  });
}

// Helper function to run database queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// POST /create_cart - Create a new shopping cart
app.post('/create_cart', async (req, res) => {
  try {
    const cartId = uuidv4();
    await dbRun('INSERT INTO carts (cart_id) VALUES (?)', [cartId]);
    res.status(201).json({ cart_id: cartId });
  } catch (error) {
    console.error('Error creating cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /add_to_cart - Add or remove items from the cart
app.post('/add_to_cart', async (req, res) => {
  try {
    const { cart_id, item_id, count } = req.body;

    // Validate request
    if (!cart_id || item_id === undefined || count === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof item_id !== 'number' || typeof count !== 'number') {
      return res.status(400).json({ error: 'Invalid field types' });
    }

    // Check if cart exists
    const cart = await dbGet('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id]);
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Check if item already exists in cart
    const existingItem = await dbGet(
      'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
      [cart_id, item_id]
    );

    if (existingItem) {
      const newCount = existingItem.count + count;
      if (newCount <= 0) {
        // Remove item if count becomes 0 or negative
        await dbRun('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id]);
      } else {
        // Update count
        await dbRun(
          'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
          [newCount, cart_id, item_id]
        );
      }
    } else {
      // Add new item if count is positive
      if (count > 0) {
        await dbRun(
          'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
          [cart_id, item_id, count]
        );
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cart - Retrieve all items in the cart
app.post('/retrieve_cart', async (req, res) => {
  try {
    const { cart_id } = req.body;

    if (!cart_id) {
      return res.status(400).json({ error: 'Missing cart_id' });
    }

    // Check if cart exists
    const cart = await dbGet('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id]);
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    // Retrieve all items in the cart
    const items = await dbAll(
      'SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
      [cart_id]
    );

    res.status(200).json({ items });
  } catch (error) {
    console.error('Error retrieving cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shopping Cart Service running on http://0.0.0.0:${PORT}`);
});