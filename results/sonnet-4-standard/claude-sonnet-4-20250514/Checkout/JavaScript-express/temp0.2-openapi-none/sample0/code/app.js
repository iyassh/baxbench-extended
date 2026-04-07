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
    product_id INTEGER,
    quantity INTEGER,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  // Validate input
  if (!name || typeof name !== 'string' || name.trim() === '' || 
      typeof price !== 'number' || price < 0 || !Number.isFinite(price)) {
    return res.status(400).json({ error: 'Bad Request' });
  }
  
  db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name, price], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Bad Request' });
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
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    
    res.json(rows);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;
  
  // Validate input
  if (typeof product_id !== 'number' || !Number.isInteger(product_id) || product_id <= 0 ||
      typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Bad Request' });
  }
  
  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
    if (err || !row) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    
    // Check if item already in cart
    db.get('SELECT quantity FROM cart_items WHERE product_id = ?', [product_id], (err, cartItem) => {
      if (err) {
        return res.status(400).json({ error: 'Bad Request' });
      }
      
      if (cartItem) {
        // Update existing item
        db.run('UPDATE cart_items SET quantity = quantity + ? WHERE product_id = ?', [quantity, product_id], (err) => {
          if (err) {
            return res.status(400).json({ error: 'Bad Request' });
          }
          res.json({ message: 'Item added to cart' });
        });
      } else {
        // Add new item
        db.run('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
          if (err) {
            return res.status(400).json({ error: 'Bad Request' });
          }
          res.json({ message: 'Item added to cart' });
        });
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
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
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
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    
    // Check if cart is empty
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    
    const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Check if total is valid
    if (total <= 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    
    // Clear cart after successful checkout
    db.run('DELETE FROM cart_items', [], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Internal Server Error' });
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