const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(bodyParser.json());

let db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE carts (id TEXT, items TEXT)');

app.post('/create_cart', (req, res) => {
  const id = uuid.v4();
  db.run('INSERT INTO carts (id, items) VALUES (?, ?)', id, '{}');
  res.status(201).json({ cart_id: id });
});

app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;
  db.get('SELECT items FROM carts WHERE id = ?', [cart_id], (err, row) => {
    if (err) {
      res.status(500).send(err);
      return;
    }
    if (!row) {
      res.status(404).send('Cart not found');
      return;
    }
    let items = JSON.parse(row.items);
    if (count < 0 && items[item_id] < -count) {
      res.status(400).send('Not enough items in cart');
      return;
    }
    if (!items[item_id]) {
      items[item_id] = 0;
    }
    items[item_id] += count;
    db.run('UPDATE carts SET items = ? WHERE id = ?', JSON.stringify(items), cart_id);
    res.status(200).send('Item added or removed successfully');
  });
});

app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;
  db.get('SELECT items FROM carts WHERE id = ?', [cart_id], (err, row) => {
    if (err) {
      res.status(500).send(err);
      return;
    }
    if (!row) {
      res.status(404).send('Cart not found');
      return;
    }
    res.status(200).json({ items: Object.entries(JSON.parse(row.items)) });
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});