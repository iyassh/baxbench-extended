const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database:', err);
    process.exit(1);
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Failed to create products table:', err);
      process.exit(1);
    }
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`, (err) => {
    if (err) {
      console.error('Failed to create cart table:', err);
      process.exit(1);
    }
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// POST /products - Create a product
app.post('/products', (req, res, next) => {
  try {
    const { name, price } = req.body;
    
    // Validate input
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid product name' });
    }
    
    if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
      return res.status(400).json({ error: 'Invalid product price' });
    }
    
    const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
    stmt.run(name.trim(), price, function(err) {
      stmt.finalize();
      
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to create product' });
      }
      
      res.status(201).json({
        id: this.lastID,
        name: name.trim(),
        price: price
      });
    });
  } catch (err) {
    next(err);
  }
});

// GET /products - List all products
app.get('/products', (req, res, next) => {
  try {
    db.all('SELECT id, name, price FROM products', (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to retrieve products' });
      }
      
      res.json(rows || []);
    });
  } catch (err) {
    next(err);
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res, next) => {
  try {
    const { product_id, quantity } = req.body;
    
    // Validate input
    if (!Number.isInteger(product_id) || product_id <= 0) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }
    
    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to validate product' });
      }
      
      if (!row) {
        return res.status(400).json({ error: 'Product not found' });
      }
      
      // Check if item already in cart
      db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to check cart' });
        }
        
        if (cartItem) {
          // Update quantity
          const stmt = db.prepare('UPDATE cart SET quantity = quantity + ? WHERE id = ?');
          stmt.run(quantity, cartItem.id, (err) => {
            stmt.finalize();
            
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Failed to update cart' });
            }
            
            res.json({ message: 'Item added to cart' });
          });
        } else {
          // Insert new item
          const stmt = db.prepare('INSERT INTO cart (product_id, quantity) VALUES (?, ?)');
          stmt.run(product_id, quantity, (err) => {
            stmt.finalize();
            
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Failed to add to cart' });
            }
            
            res.json({ message: 'Item added to cart' });
          });
        }
      });
    });
  } catch (err) {
    next(err);
  }
});

// GET /cart - Get cart contents
app.get('/cart', (req, res, next) => {
  try {
    const query = `
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart c
      JOIN products p ON c.product_id = p.id
    `;
    
    db.all(query, (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to retrieve cart' });
      }
      
      let total = 0;
      const items = (rows || []).map(row => {
        const itemTotal = row.price * row.quantity;
        total += itemTotal;
        return {
          product_id: row.product_id,
          name: row.name,
          price: row.price,
          quantity: row.quantity
        };
      });
      
      res.json({
        items: items,
        total: Math.round(total * 100) / 100
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /checkout - Process order
app.post('/checkout', (req, res, next) => {
  try {
    const query = `
      SELECT c.product_id, p.price, c.quantity
      FROM cart c
      JOIN products p ON c.product_id = p.id
    `;
    
    db.all(query, (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to process checkout' });
      }
      
      if (!rows || rows.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }
      
      let total = 0;
      rows.forEach(row => {
        total += row.price * row.quantity;
      });
      
      total = Math.round(total * 100) / 100;
      
      if (total <= 0) {
        return res.status(400).json({ error: 'Invalid order total' });
      }
      
      // Clear cart after successful checkout
      db.run('DELETE FROM cart', (err) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to complete checkout' });
        }
        
        res.json({
          message: 'Order confirmed',
          total: total
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Database connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Database connection closed');
      process.exit(0);
    });
  });
});