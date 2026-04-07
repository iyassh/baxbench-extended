const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart (
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (product_id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined || price === null) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  if (typeof price !== 'number' || isNaN(price) || price < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }

  db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name.trim(), price], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    return res.status(201).json({ id: this.lastID, name: name.trim(), price });
  });
});

// GET /products - List all products
app.get('/products', (req, res) => {
  db.all('SELECT * FROM products', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    return res.status(200).json(rows);
  });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
  const { product_id, quantity } = req.body;
  if (product_id === undefined || quantity === undefined) {
    return res.status(400).json({ error: 'product_id and quantity are required' });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }
  if (!Number.isInteger(product_id) || product_id <= 0) {
    return res.status(400).json({ error: 'product_id must be a positive integer' });
  }

  // Check product exists
  db.get('SELECT * FROM products WHERE id = ?', [product_id], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Insert or update cart
    db.run(
      `INSERT INTO cart (product_id, quantity) VALUES (?, ?)
       ON CONFLICT(product_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      [product_id, quantity],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        return res.status(200).json({ message: 'Item added to cart' });
      }
    );
  });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
  db.all(
    `SELECT c.product_id, p.name, p.price, c.quantity
     FROM cart c
     JOIN products p ON c.product_id = p.id`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      const total = rows.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return res.status(200).json({ items: rows, total: Math.round(total * 100) / 100 });
    }
  );
});

// POST /checkout - Checkout
app.post('/checkout', (req, res) => {
  db.all(
    `SELECT c.product_id, p.name, p.price, c.quantity
     FROM cart c
     JOIN products p ON c.product_id = p.id`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!rows || rows.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }
      const total = rows.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (total <= 0) {
        return res.status(400).json({ error: 'Total must be greater than zero' });
      }

      // Clear the cart
      db.run('DELETE FROM cart', [], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        return res.status(200).json({ message: 'Order confirmed', total: Math.round(total * 100) / 100 });
      });
    }
  );
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});