const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Failed to create products table:', err.message);
      process.exit(1);
    }
  });
  
  db.run(`
    CREATE TABLE IF NOT EXISTS cart_items (
      session_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      PRIMARY KEY (session_id, product_id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `, (err) => {
    if (err) {
      console.error('Failed to create cart_items table:', err.message);
      process.exit(1);
    }
  });
});

// Session middleware
app.use((req, res, next) => {
  let sessionId = req.cookies.session_id;
  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie('session_id', sessionId, { 
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
  }
  req.sessionId = sessionId;
  next();
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /products - Create a product
app.post('/products', (req, res) => {
  try {
    const { name, price } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid product name' });
    }
    
    if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
      return res.status(400).json({ error: 'Invalid product price' });
    }
    
    const cleanName = name.trim();
    const cleanPrice = parseFloat(price.toFixed(2));
    
    db.run(
      'INSERT INTO products (name, price) VALUES (?, ?)',
      [cleanName, cleanPrice],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to create product' });
        }
        
        res.status(201).json({
          id: this.lastID,
          name: cleanName,
          price: cleanPrice
        });
      }
    );
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products - List all products
app.get('/products', (req, res) => {
  try {
    db.all('SELECT id, name, price FROM products', [], (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to retrieve products' });
      }
      res.json(rows || []);
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    const sessionId = req.sessionId;
    
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
        return res.status(500).json({ error: 'Failed to verify product' });
      }
      
      if (!row) {
        return res.status(400).json({ error: 'Product not found' });
      }
      
      // Add or update cart item
      db.run(
        `INSERT INTO cart_items (session_id, product_id, quantity) 
         VALUES (?, ?, ?) 
         ON CONFLICT(session_id, product_id) 
         DO UPDATE SET quantity = quantity + excluded.quantity`,
        [sessionId, product_id, quantity],
        (err) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to add item to cart' });
          }
          
          res.json({ message: 'Item added to cart' });
        }
      );
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  try {
    const sessionId = req.sessionId;
    
    db.all(
      `SELECT c.product_id, p.name, p.price, c.quantity 
       FROM cart_items c 
       JOIN products p ON c.product_id = p.id 
       WHERE c.session_id = ?`,
      [sessionId],
      (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to retrieve cart' });
        }
        
        let total = 0;
        const items = (rows || []).map(row => {
          const subtotal = row.price * row.quantity;
          total += subtotal;
          return {
            product_id: row.product_id,
            name: row.name,
            price: row.price,
            quantity: row.quantity
          };
        });
        
        res.json({
          items: items,
          total: parseFloat(total.toFixed(2))
        });
      }
    );
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  try {
    const sessionId = req.sessionId;
    
    db.all(
      `SELECT c.product_id, p.price, c.quantity 
       FROM cart_items c 
       JOIN products p ON c.product_id = p.id 
       WHERE c.session_id = ?`,
      [sessionId],
      (err, rows) => {
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
        
        total = parseFloat(total.toFixed(2));
        
        if (total <= 0) {
          return res.status(400).json({ error: 'Invalid cart total' });
        }
        
        // Clear the cart
        db.run('DELETE FROM cart_items WHERE session_id = ?', [sessionId], (err) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to process checkout' });
          }
          
          res.json({
            message: 'Order confirmed',
            total: total
          });
        });
      }
    );
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(errorHandler);

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Server closed');
      process.exit(0);
    });
  });
});