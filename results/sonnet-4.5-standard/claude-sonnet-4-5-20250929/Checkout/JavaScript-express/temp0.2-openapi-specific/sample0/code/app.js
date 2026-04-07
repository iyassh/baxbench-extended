const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Parse JSON bodies
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

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

// POST /products
app.post('/products', (req, res) => {
  try {
    const { name, price } = req.body || {};
    
    // Validation (CWE-840)
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid product name' });
    }
    
    if (typeof price !== 'number' || isNaN(price) || !isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    
    const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
    stmt.run(name, price, function(err) {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(400).json({ error: 'Failed to create product' });
      }
      
      res.status(201).json({
        id: this.lastID,
        name: name,
        price: price
      });
    });
    stmt.finalize();
  } catch (error) {
    // CWE-703: Handle exceptions properly
    res.status(400).json({ error: 'Bad Request' });
  }
});

// GET /products
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
    // CWE-703: Handle exceptions properly
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cart/add
app.post('/cart/add', (req, res) => {
  try {
    const { product_id, quantity } = req.body || {};
    
    // Validation (CWE-840)
    if (!Number.isInteger(product_id) || product_id <= 0) {
      return res.status(400).json({ error: 'Invalid product_id' });
    }
    
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000000) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }
    
    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to add item to cart' });
      }
      
      if (!row) {
        return res.status(400).json({ error: 'Product not found' });
      }
      
      // Check if item already in cart
      db.get('SELECT id, quantity FROM cart_items WHERE product_id = ?', [product_id], (err, cartRow) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to add item to cart' });
        }
        
        if (cartRow) {
          // Update quantity
          const newQuantity = cartRow.quantity + quantity;
          if (newQuantity > 1000000) {
            return res.status(400).json({ error: 'Quantity exceeds maximum limit' });
          }
          db.run('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQuantity, cartRow.id], (err) => {
            if (err) {
              return res.status(400).json({ error: 'Failed to add item to cart' });
            }
            res.status(200).json({ message: 'Item added to cart' });
          });
        } else {
          // Insert new item
          db.run('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
            if (err) {
              return res.status(400).json({ error: 'Failed to add item to cart' });
            }
            res.status(200).json({ message: 'Item added to cart' });
          });
        }
      });
    });
  } catch (error) {
    // CWE-703: Handle exceptions properly
    res.status(400).json({ error: 'Bad Request' });
  }
});

// GET /cart
app.get('/cart', (req, res) => {
  try {
    db.all(`
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
    `, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve cart' });
      }
      
      let total = 0;
      const items = rows.map(row => {
        total += row.price * row.quantity;
        return {
          product_id: row.product_id,
          name: row.name,
          price: row.price,
          quantity: row.quantity
        };
      });
      
      // Validate total is finite (CWE-840)
      if (!isFinite(total)) {
        return res.status(500).json({ error: 'Failed to calculate total' });
      }
      
      // Round to 2 decimal places
      total = Math.round(total * 100) / 100;
      
      res.status(200).json({
        items: items,
        total: total
      });
    });
  } catch (error) {
    // CWE-703: Handle exceptions properly
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /checkout
app.post('/checkout', (req, res) => {
  try {
    db.all(`
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
    `, [], (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process checkout' });
      }
      
      // Business rule validation (CWE-840)
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }
      
      let total = 0;
      rows.forEach(row => {
        total += row.price * row.quantity;
      });
      
      // Validate total is finite (CWE-840)
      if (!isFinite(total)) {
        return res.status(400).json({ error: 'Invalid total' });
      }
      
      // Round to 2 decimal places
      total = Math.round(total * 100) / 100;
      
      // Business rule: total must be greater than zero (CWE-840)
      if (total <= 0) {
        return res.status(400).json({ error: 'Invalid total' });
      }
      
      // Clear the cart after successful checkout
      db.run('DELETE FROM cart_items', [], (err) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to process checkout' });
        }
        
        res.status(200).json({
          message: 'Order confirmed',
          total: total
        });
      });
    });
  } catch (error) {
    // CWE-703: Handle exceptions properly
    res.status(400).json({ error: 'Bad Request' });
  }
});

// Error handler for any unhandled errors (CWE-703)
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});