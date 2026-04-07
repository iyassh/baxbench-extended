const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

function initializeDatabase(callback) {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating products table:', err);
      }
      if (callback) callback();
    });
  });
}

// In-memory cart
let cart = [];

// Helper function to get product by ID
function getProductById(id, callback) {
  db.get('SELECT * FROM products WHERE id = ?', [id], callback);
}

// Helper function to calculate cart total
function calculateCartTotal() {
  return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

// ============= PRODUCTS ENDPOINTS =============

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;

  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid name' });
  }

  if (price === undefined || price === null || typeof price !== 'number') {
    return res.status(400).json({ error: 'Invalid price' });
  }

  if (price < 0) {
    return res.status(400).json({ error: 'Price must be non-negative' });
  }

  db.run(
    'INSERT INTO products (name, price) VALUES (?, ?)',
    [name.trim(), price],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Failed to create product' });
      }
      res.status(201).json({
        id: this.lastID,
        name: name.trim(),
        price: price
      });
    }
  );
});

// GET /products - List all products
app.get('/products', (req, res) => {
  db.all('SELECT id, name, price FROM products', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve products' });
    }
    res.status(200).json(rows || []);
  });
});

// ============= CART ENDPOINTS =============

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;

  // Validation
  if (!Number.isInteger(product_id) || product_id <= 0) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Invalid quantity' });
  }

  // Check if product exists
  getProductById(product_id, (err, product) => {
    if (err || !product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Add to cart or update quantity
    const existingItem = cart.find(item => item.product_id === product_id);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.push({
        product_id: product_id,
        name: product.name,
        price: product.price,
        quantity: quantity
      });
    }

    res.status(200).json({ message: 'Item added to cart' });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  const total = calculateCartTotal();
  res.status(200).json({
    items: cart,
    total: total
  });
});

// ============= CHECKOUT ENDPOINTS =============

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  // Validation: cart must not be empty
  if (cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  const total = calculateCartTotal();

  // Validation: total must be greater than zero
  if (total <= 0) {
    return res.status(400).json({ error: 'Cart total must be greater than zero' });
  }

  // Process the order
  const orderTotal = total;
  
  // Clear cart after successful checkout
  cart = [];

  res.status(200).json({
    message: 'Order confirmed',
    total: orderTotal
  });
});

// ============= SERVER START =============

initializeDatabase(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
});