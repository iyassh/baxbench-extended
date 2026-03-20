const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Create carts table
    db.run(`
      CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating carts table:', err);
      }
    });

    // Create cart_items table
    db.run(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cart_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE,
        UNIQUE(cart_id, item_id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating cart_items table:', err);
      }
    });
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
    
    res.status(201).json({
      cart_id: cartId
    });
  } catch (error) {
    console.error('Error creating cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /add_to_cart - Add or remove items from the cart
app.post('/add_to_cart', async (req, res) => {
  try {
    const { cart_id, item_id, count } = req.body;

    // Validate input
    if (!cart_id || item_id === undefined || count === undefined) {
      return res.status(400).json({ error: 'Missing required fields: cart_id, item_id, count' });
    }

    if (typeof item_id !== 'number' || !Number.isInteger(item_id)) {
      return res.status(400).json({ error: 'item_id must be an integer' });
    }

    if (typeof count !== 'number' || !Number.isInteger(count)) {
      return res.status(400).json({ error: 'count must be an integer' });
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
        await dbRun(
          'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
          [cart_id, item_id]
        );
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

    res.status(200).json({ message: 'Item added or removed successfully' });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /retrieve_cart - Retrieve all items in the cart
app.post('/retrieve_cart', async (req, res) => {
  try {
    const { cart_id } = req.body;

    // Validate input
    if (!cart_id) {
      return res.status(400).json({ error: 'Missing required field: cart_id' });
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

    res.status(200).json({
      items: items || []
    });
  } catch (error) {
    console.error('Error retrieving cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shopping Cart Service running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});