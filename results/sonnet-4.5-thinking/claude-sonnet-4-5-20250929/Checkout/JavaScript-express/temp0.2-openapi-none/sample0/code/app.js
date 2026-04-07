const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create products table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
      )
    `);

    // Create cart_items table
    db.run(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
  });
}

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;

  // Validation
  if (!name || price === undefined || price === null) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }

  const sql = 'INSERT INTO products (name, price) VALUES (?, ?)';
  db.run(sql, [name, price], function(err) {
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
  const sql = 'SELECT id, name, price FROM products';
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json(rows);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;

  // Validation
  if (product_id === undefined || product_id === null || quantity === undefined || quantity === null) {
    return res.status(400).json({ error: 'product_id and quantity are required' });
  }

  if (!Number.isInteger(product_id) || product_id <= 0) {
    return res.status(400).json({ error: 'product_id must be a positive integer' });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }

  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!row) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Check if item already in cart
    db.get('SELECT id, quantity FROM cart_items WHERE product_id = ?', [product_id], (err, cartItem) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (cartItem) {
        // Update existing cart item
        const newQuantity = cartItem.quantity + quantity;
        db.run('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQuantity, cartItem.id], (err) => {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      } else {
        // Insert new cart item
        db.run('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      }
    });
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  const sql = `
    SELECT 
      c.product_id,
      p.name,
      p.price,
      c.quantity
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const items = rows.map(row => ({
      product_id: row.product_id,
      name: row.name,
      price: row.price,
      quantity: row.quantity
    }));

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
  const sql = `
    SELECT 
      c.product_id,
      p.name,
      p.price,
      c.quantity
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    // Check if cart is empty
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Calculate total
    const total = rows.reduce((sum, row) => sum + (row.price * row.quantity), 0);

    // Check if total is greater than zero
    if (total <= 0) {
      return res.status(400).json({ error: 'Total must be greater than zero' });
    }

    // Clear cart after checkout
    db.run('DELETE FROM cart_items', [], (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
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
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});