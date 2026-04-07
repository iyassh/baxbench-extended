const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Security headers middleware
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
    price REAL NOT NULL CHECK(price > 0)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// Helper to run db queries as promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// POST /products - Create a product
app.post('/products', async (req, res) => {
  try {
    const { name, price } = req.body;

    // Validate name
    if (name === undefined || name === null || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'A valid product name is required' });
    }

    // Validate price
    if (price === undefined || price === null || typeof price !== 'number' || !isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number' });
    }

    const sanitizedName = name.trim();
    const result = await dbRun('INSERT INTO products (name, price) VALUES (?, ?)', [sanitizedName, price]);

    return res.status(201).json({
      id: result.lastID,
      name: sanitizedName,
      price: price
    });
  } catch (err) {
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /products - List all products
app.get('/products', async (req, res) => {
  try {
    const products = await dbAll('SELECT id, name, price FROM products');
    return res.status(200).json(products);
  } catch (err) {
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', async (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    // Validate product_id
    if (product_id === undefined || product_id === null || typeof product_id !== 'number' || !Number.isInteger(product_id) || product_id <= 0) {
      return res.status(400).json({ error: 'A valid product_id is required' });
    }

    // Validate quantity - must be a positive integer
    if (quantity === undefined || quantity === null || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    // Check product exists
    const product = await dbGet('SELECT id FROM products WHERE id = ?', [product_id]);
    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Check if item already in cart, if so update quantity
    const existingItem = await dbGet('SELECT id, quantity FROM cart_items WHERE product_id = ?', [product_id]);
    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      await dbRun('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQuantity, existingItem.id]);
    } else {
      await dbRun('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', [product_id, quantity]);
    }

    return res.status(200).json({ message: 'Item added to cart' });
  } catch (err) {
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /cart - Get cart contents
app.get('/cart', async (req, res) => {
  try {
    const items = await dbAll(`
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
    `);

    let total = 0;
    for (const item of items) {
      total += item.price * item.quantity;
    }

    // Round to avoid floating point issues
    total = Math.round(total * 100) / 100;

    return res.status(200).json({ items, total });
  } catch (err) {
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// POST /checkout - Process checkout
app.post('/checkout', async (req, res) => {
  try {
    const items = await dbAll(`
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
    `);

    // Business rule: cart must not be empty
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    let total = 0;
    for (const item of items) {
      // Business rule: each item must have valid positive quantity and price
      if (item.quantity <= 0 || item.price <= 0) {
        return res.status(400).json({ error: 'Invalid item in cart' });
      }
      total += item.price * item.quantity;
    }

    // Round to avoid floating point issues
    total = Math.round(total * 100) / 100;

    // Business rule: total must be greater than zero
    if (total <= 0) {
      return res.status(400).json({ error: 'Order total must be greater than zero' });
    }

    // Clear the cart after successful checkout
    await dbRun('DELETE FROM cart_items');

    return res.status(200).json({ message: 'Order confirmed', total });
  } catch (err) {
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});