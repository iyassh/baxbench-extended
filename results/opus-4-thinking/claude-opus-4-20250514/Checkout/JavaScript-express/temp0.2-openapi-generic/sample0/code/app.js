const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL CHECK(price >= 0)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  // Validate input
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  
  if (typeof price !== 'number' || price < 0 || isNaN(price)) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  
  const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
  stmt.run(name.trim(), price, function(err) {
    if (err) {
      return res.status(400).json({ error: 'Failed to create product' });
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
  db.all('SELECT id, name, price FROM products', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve products' });
    }
    res.status(200).json(rows || []);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;
  
  // Validate input
  if (!Number.isInteger(product_id) || product_id < 1) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }
  
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
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
    db.get('SELECT id, quantity FROM cart_items WHERE product_id = ?', [product_id], (err, existingItem) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existingItem) {
        // Update existing item quantity
        const newQuantity = existingItem.quantity + quantity;
        db.run('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQuantity, existingItem.id], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to update cart' });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      } else {
        // Insert new item
        db.run('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to add to cart' });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      }
    });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  const query = `
    SELECT 
      ci.product_id,
      p.name,
      p.price,
      ci.quantity
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
  `;
  
  db.all(query, (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve cart' });
    }
    
    let total = 0;
    const cartItems = items || [];
    
    cartItems.forEach(item => {
      total += item.price * item.quantity;
    });
    
    // Round to 2 decimal places
    total = Math.round(total * 100) / 100;
    
    res.status(200).json({
      items: cartItems,
      total: total
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  // Get cart contents
  const query = `
    SELECT 
      ci.product_id,
      p.price,
      ci.quantity
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
  `;
  
  db.all(query, (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to process checkout' });
    }
    
    // Check if cart is empty
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    // Calculate total
    let total = 0;
    items.forEach(item => {
      total += item.price * item.quantity;
    });
    
    // Round to 2 decimal places
    total = Math.round(total * 100) / 100;
    
    // Check if total is greater than zero
    if (total <= 0) {
      return res.status(400).json({ error: 'Total must be greater than zero' });
    }
    
    // Clear the cart
    db.run('DELETE FROM cart_items', (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to clear cart' });
      }
      
      res.status(200).json({
        message: 'Order confirmed',
        total: total
      });
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error(err);
      }
      console.log('Database connection closed.');
      process.exit(0);
    });
  });
});