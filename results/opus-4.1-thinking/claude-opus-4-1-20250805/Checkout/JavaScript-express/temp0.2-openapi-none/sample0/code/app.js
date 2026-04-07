const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create products table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`);
});

// In-memory cart (in production, you'd want to use sessions or a database)
let cart = {
  items: [],
  total: 0
};

// Helper function to calculate cart total
function calculateCartTotal() {
  cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  return cart.total;
}

// POST /products - Create a new product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  
  if (!name || price === undefined || price === null) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  
  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'Price must be a positive number' });
  }
  
  const query = `INSERT INTO products (name, price) VALUES (?, ?)`;
  
  db.run(query, [name, price], function(err) {
    if (err) {
      return res.status(400).json({ error: err.message });
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
  const query = `SELECT id, name, price FROM products`;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(rows);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;
  
  if (!product_id || !quantity) {
    return res.status(400).json({ error: 'Product ID and quantity are required' });
  }
  
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }
  
  // Check if product exists
  const query = `SELECT id, name, price FROM products WHERE id = ?`;
  
  db.get(query, [product_id], (err, product) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }
    
    // Check if product is already in cart
    const existingItem = cart.items.find(item => item.product_id === product_id);
    
    if (existingItem) {
      // Update quantity if product already in cart
      existingItem.quantity += quantity;
    } else {
      // Add new item to cart
      cart.items.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        quantity: quantity
      });
    }
    
    calculateCartTotal();
    
    res.json({ message: 'Item added to cart' });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  res.json({
    items: cart.items,
    total: cart.total
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  if (cart.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  
  const total = calculateCartTotal();
  
  if (total <= 0) {
    return res.status(400).json({ error: 'Cart total must be greater than zero' });
  }
  
  // Process the order (in a real app, you'd save to database)
  const orderTotal = cart.total;
  
  // Clear the cart after successful checkout
  cart = {
    items: [],
    total: 0
  };
  
  res.json({
    message: 'Order confirmed',
    total: orderTotal
  });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});