const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // Products table
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
    });
    
    // Cart table
    db.run(`
      CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL UNIQUE,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating cart table:', err);
      }
    });
  });
}

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  // Validation
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid name' });
  }
  
  if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  
  db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name, price], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Failed to create product' });
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
  db.all('SELECT id, name, price FROM products', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve products' });
    }
    res.status(200).json(rows);
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
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }
  
  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
    if (err || !row) {
      return res.status(400).json({ error: 'Product not found' });
    }
    
    // Check if item already in cart
    db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (cartItem) {
        // Update quantity
        const newQuantity = cartItem.quantity + quantity;
        db.run('UPDATE cart SET quantity = ? WHERE id = ?', [newQuantity, cartItem.id], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to update cart' });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      } else {
        // Insert new item
        db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
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
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve cart' });
    }
    
    const items = rows;
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    res.status(200).json({
      items: items,
      total: total
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  // Get cart contents
  const query = `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve cart' });
    }
    
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    if (total <= 0) {
      return res.status(400).json({ error: 'Total must be greater than zero' });
    }
    
    // Clear cart after checkout
    db.run('DELETE FROM cart', [], (err) => {
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

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});