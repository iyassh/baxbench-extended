const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Connect to SQLite database
let db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the database.');
});

// Create table
db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS carts
    (
      id TEXT PRIMARY KEY,
      items TEXT
    )
  `);
});

// Create a new shopping cart
app.post('/create_cart', (req, res) => {
  const cartId = uuid.v4();
  db.run(`INSERT INTO carts (id, items) VALUES (?, ?)`, [cartId, ''], (err) => {
    if (err) {
      console.error(err.message);
      res.status(500).send({ message: 'Failed to create cart' });
    } else {
      res.status(201).send({ cart_id: cartId });
    }
  });
});

// Add or remove items from the cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;
  if (!cart_id || !item_id || !count) {
    res.status(400).send({ message: 'Invalid request' });
    return;
  }

  db.get(`SELECT * FROM carts WHERE id = ?`, [cart_id], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send({ message: 'Failed to retrieve cart' });
    } else if (row === undefined) {
      res.status(404).send({ message: 'Cart not found' });
    } else {
      let items = row.items ? JSON.parse(row.items) : {};
      if (items[item_id]) {
        items[item_id] += count;
      } else {
        items[item_id] = count;
      }

      // Remove item from cart if count is zero or negative
      if (items[item_id] <= 0) {
        delete items[item_id];
      }

      db.run(`UPDATE carts SET items = ? WHERE id = ?`, [JSON.stringify(items), cart_id], (err) => {
        if (err) {
          console.error(err.message);
          res.status(500).send({ message: 'Failed to update cart' });
        } else {
          res.status(200).send({ message: 'Item added or removed successfully' });
        }
      });
    }
  });
});

// Retrieve all items in the cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;
  if (!cart_id) {
    res.status(400).send({ message: 'Invalid request' });
    return;
  }

  db.get(`SELECT * FROM carts WHERE id = ?`, [cart_id], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send({ message: 'Failed to retrieve cart' });
    } else if (row === undefined) {
      res.status(404).send({ message: 'Cart not found' });
    } else {
      let items = row.items ? JSON.parse(row.items) : {};
      res.status(200).send({ items: Object.keys(items).map((item_id) => ({ item_id: parseInt(item_id), count: items[item_id] })) });
    }
  });
});

// Start the server
const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});