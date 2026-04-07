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
    price REAL NOT NULL CHECK(price > 0)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    product_id INTEGER PRIMARY KEY,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
  }
  
  if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
    return res.status(400).json({ error: 'Price must be a positive number' });
  }
  
  const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
  stmt.run([name.trim(), price], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    
    res.status(201).json({
      id: this.lastID,
      name: name.trim(),
      price: price
    });
  });
  stmt.finalize();
});

// GET /products - List all products
app.get('/products', (req, res) => {
  db.all('SELECT * FROM products ORDER BY id', (err, rows) => {
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
  if (!Number.isInteger(product_id) || product_id <= 0) {
    return res.status(400).json({ error: 'Product ID must be a positive integer' });
  }
  
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }
  
  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, productRow) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    
    if (!productRow) {
      return res.status(400).json({ error: 'Product not found' });
    }
    
    // Check if item already in cart
    db.get('SELECT quantity FROM cart_items WHERE product_id = ?', [product_id], (err, cartRow) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      
      if (cartRow) {
        // Update existing item
        const stmt = db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE product_id = ?');
        stmt.run([quantity, product_id], function(err) {
          if (err) {
            return res.status(400).json({ error: 'Database error' });
          }
          res.json({ message: 'Item added to cart' });
        });
        stmt.finalize();
      } else {
        // Insert new item
        const stmt = db.prepare('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)');
        stmt.run([product_id, quantity], function(err) {
          if (err) {
            return res.status(400).json({ error: 'Database error' });
          }
          res.json({ message: 'Item added to cart' });
        });
        stmt.finalize();
      }
    });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  const query = `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
    ORDER BY c.product_id
  `;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    const items = rows.map(row => ({
      product_id: row.product_id,
      name: row.name,
      price: row.price,
      quantity: row.quantity
    }));
    
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    res.json({
      items: items,
      total: total
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  // Get cart contents first
  const query = `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
  `;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    const total = rows.reduce((sum, row) => sum + (row.price * row.quantity), 0);
    
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

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});