const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    product_id INTEGER PRIMARY KEY,
    quantity INTEGER NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '' || price == null || typeof price !== 'number' || isNaN(price) || price <= 0) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name, price], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    
    res.status(201).json({
      id: this.lastID,
      name: name,
      price: price
    });
  });
});

// GET /products - List all products
app.get('/products', (req, res) => {
  db.all('SELECT * FROM products', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;
  
  // Validation
  if (product_id == null || !Number.isInteger(product_id) || product_id <= 0 || quantity == null || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  // Check if product exists
  db.get('SELECT * FROM products WHERE id = ?', [product_id], (err, product) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }
    
    // Add to cart or update quantity using INSERT OR REPLACE
    db.run('INSERT OR REPLACE INTO cart_items (product_id, quantity) VALUES (?, COALESCE((SELECT quantity FROM cart_items WHERE product_id = ?) + ?, ?))',
      [product_id, product_id, quantity, quantity], function(err) {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      
      res.json({ message: 'Item added to cart' });
    });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  const query = `
    SELECT ci.product_id, p.name, p.price, ci.quantity
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
  `;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    res.json({
      items: rows,
      total: total
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  // Get cart contents first
  const query = `
    SELECT ci.product_id, p.name, p.price, ci.quantity
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
  `;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    if (total <= 0) {
      return res.status(400).json({ error: 'Invalid total' });
    }
    
    // Clear cart after successful checkout
    db.run('DELETE FROM cart_items', (err) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      
      res.json({
        message: 'Order confirmed',
        total: total
      });
    });
  });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});