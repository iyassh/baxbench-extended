const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
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

    // Create cart table
    db.run(`
      CREATE TABLE IF NOT EXISTS cart (
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
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid name' });
  }

  if (price === undefined || price === null || typeof price !== 'number' || price < 0 || isNaN(price)) {
    return res.status(400).json({ error: 'Invalid price' });
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
  if (!Number.isInteger(product_id) || product_id <= 0) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }

  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Check if item already in cart
    db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (cartItem) {
        // Update quantity
        const newQuantity = cartItem.quantity + quantity;
        db.run('UPDATE cart SET quantity = ? WHERE id = ?', [newQuantity, cartItem.id], (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      } else {
        // Insert new item
        db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
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
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
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

    res.status(200).json({
      items: items,
      total: total
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
  const sql = `
    SELECT 
      c.product_id,
      p.price,
      c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Check if cart is empty
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Calculate total
    let total = 0;
    rows.forEach(row => {
      total += row.price * row.quantity;
    });

    // Check if total is greater than zero
    if (total <= 0) {
      return res.status(400).json({ error: 'Invalid total' });
    }

    // Clear cart after successful checkout
    db.run('DELETE FROM cart', (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
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