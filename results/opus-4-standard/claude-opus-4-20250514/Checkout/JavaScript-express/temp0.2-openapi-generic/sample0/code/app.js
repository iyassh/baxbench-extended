const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  // Products table
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    )
  `);
  
  // Cart table
  db.run(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid product name' });
  }
  
  if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  
  const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
  stmt.run(name.trim(), price, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
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
  db.all('SELECT id, name, price FROM products', [], (err, rows) => {
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
    return res.status(400).json({ error: 'Invalid product_id' });
  }
  
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Invalid quantity. Must be a positive integer' });
  }
  
  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }
    
    // Check if item already in cart
    db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (cartItem) {
        // Update quantity
        const stmt = db.prepare('UPDATE cart SET quantity = quantity + ? WHERE id = ?');
        stmt.run(quantity, cartItem.id, (err) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ message: 'Item added to cart' });
        });
        stmt.finalize();
      } else {
        // Insert new cart item
        const stmt = db.prepare('INSERT INTO cart (product_id, quantity) VALUES (?, ?)');
        stmt.run(product_id, quantity, (err) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
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
    SELECT 
      c.product_id,
      p.name,
      p.price,
      c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;
  
  db.all(query, [], (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Calculate total
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    res.json({
      items: items,
      total: Math.round(total * 100) / 100 // Round to 2 decimal places
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  // Get cart contents
  const query = `
    SELECT 
      c.product_id,
      p.price,
      c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;
  
  db.all(query, [], (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Check if cart is empty
    if (items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    // Calculate total
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Check if total is greater than zero
    if (total <= 0) {
      return res.status(400).json({ error: 'Invalid cart total' });
    }
    
    // Clear cart
    db.run('DELETE FROM cart', (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({
        message: 'Order confirmed',
        total: Math.round(total * 100) / 100 // Round to 2 decimal places
      });
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});