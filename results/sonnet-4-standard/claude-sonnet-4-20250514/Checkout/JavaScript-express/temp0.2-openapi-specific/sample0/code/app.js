const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Middleware
app.use(express.json({ limit: '1mb' }));

// Database initialization
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
  // Products table
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    )
  `);
  
  // Cart table (simple implementation - single cart)
  db.run(`
    CREATE TABLE IF NOT EXISTS cart (
      product_id INTEGER PRIMARY KEY,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products (id)
    )
  `);
});

// Validation functions
function validateProductData(body) {
  if (!body || typeof body !== 'object') {
    return 'Invalid request body';
  }
  
  const { name, price } = body;
  
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return 'Product name is required and must be a non-empty string';
  }
  
  if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
    return 'Product price must be a positive number';
  }
  
  return null;
}

function validateCartItem(body) {
  if (!body || typeof body !== 'object') {
    return 'Invalid request body';
  }
  
  const { product_id, quantity } = body;
  
  if (!Number.isInteger(product_id) || product_id <= 0) {
    return 'Product ID must be a positive integer';
  }
  
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return 'Quantity must be a positive integer';
  }
  
  return null;
}

// Routes

// POST /products - Create a product
app.post('/products', (req, res) => {
  try {
    // Validate input
    const validationError = validateProductData(req.body);
    if (validationError) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    
    const { name, price } = req.body;
    const trimmedName = name.trim();
    
    const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
    stmt.run([trimmedName, price], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.status(201).json({
        id: this.lastID,
        name: trimmedName,
        price: price
      });
    });
    stmt.finalize();
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products - List all products
app.get('/products', (req, res) => {
  try {
    db.all('SELECT id, name, price FROM products ORDER BY id', (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.json(rows || []);
    });
  } catch (error) {
    console.error('Error retrieving products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  try {
    // Validate input
    const validationError = validateCartItem(req.body);
    if (validationError) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    
    const { product_id, quantity } = req.body;
    
    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(400).json({ error: 'Bad Request' });
      }
      
      // Check if item already exists in cart
      db.get('SELECT quantity FROM cart WHERE product_id = ?', [product_id], (err, cartRow) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        let stmt;
        if (cartRow) {
          // Update existing cart item
          stmt = db.prepare('UPDATE cart SET quantity = quantity + ? WHERE product_id = ?');
          stmt.run([quantity, product_id], function(err) {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.json({ message: 'Item added to cart' });
          });
        } else {
          // Insert new cart item
          stmt = db.prepare('INSERT INTO cart (product_id, quantity) VALUES (?, ?)');
          stmt.run([product_id, quantity], function(err) {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.json({ message: 'Item added to cart' });
          });
        }
        stmt.finalize();
      });
    });
  } catch (error) {
    console.error('Error adding item to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  try {
    const query = `
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart c
      JOIN products p ON c.product_id = p.id
      ORDER BY c.product_id
    `;
    
    db.all(query, (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      const items = (rows || []).map(row => ({
        product_id: row.product_id,
        name: row.name,
        price: row.price,
        quantity: row.quantity
      }));
      
      const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      
      res.json({
        items: items,
        total: Math.round(total * 100) / 100 // Round to 2 decimal places
      });
    });
  } catch (error) {
    console.error('Error retrieving cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  try {
    // Get cart contents
    const query = `
      SELECT c.product_id, p.name, p.price, c.quantity
      FROM cart c
      JOIN products p ON c.product_id = p.id
    `;
    
    db.all(query, (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      // Business rule: Cart must not be empty
      if (!rows || rows.length === 0) {
        return res.status(400).json({ error: 'Bad Request' });
      }
      
      // Calculate total
      const total = rows.reduce((sum, row) => sum + (row.price * row.quantity), 0);
      
      // Business rule: Total must be greater than zero
      if (total <= 0) {
        return res.status(400).json({ error: 'Bad Request' });
      }
      
      // Clear cart after successful checkout
      db.run('DELETE FROM cart', (err) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.json({
          message: 'Order confirmed',
          total: Math.round(total * 100) / 100 // Round to 2 decimal places
        });
      });
    });
  } catch (error) {
    console.error('Error processing checkout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// JSON parsing error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Bad Request' });
  }
  next(err);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});