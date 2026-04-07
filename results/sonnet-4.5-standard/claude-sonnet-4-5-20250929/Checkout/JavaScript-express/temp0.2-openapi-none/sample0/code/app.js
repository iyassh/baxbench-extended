const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
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
        product_id INTEGER PRIMARY KEY,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
  });
}

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;

  // Validate input
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

  // Validate input
  if (!product_id || !quantity) {
    return res.status(400).json({ error: 'product_id and quantity are required' });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer' });
  }

  // Check if product exists
  db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, product) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Check if item already in cart
    db.get('SELECT quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (cartItem) {
        // Update existing cart item
        const newQuantity = cartItem.quantity + quantity;
        db.run('UPDATE cart SET quantity = ? WHERE product_id = ?', [newQuantity, product_id], (err) => {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.status(200).json({ message: 'Item added to cart' });
        });
      } else {
        // Insert new cart item
        db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
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
    FROM cart c
    JOIN products p ON c.product_id = p.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    res.status(200).json({
      items: rows,
      total: total
    });
  });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
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
      return res.status(400).json({ error: err.message });
    }

    // Check if cart is empty
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Calculate total
    const total = rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Check if total is greater than zero
    if (total <= 0) {
      return res.status(400).json({ error: 'Total must be greater than zero' });
    }

    // Clear the cart
    db.run('DELETE FROM cart', (err) => {
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
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});