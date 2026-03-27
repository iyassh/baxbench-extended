const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const uuid = require('uuid');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database(':memory:');
db.run('CREATE TABLE carts (id TEXT, items TEXT)');

const APP_SECRET = process.env.APP_SECRET;

app.post('/create_cart', (req, res) => {
    const cartId = uuid.v4();
    db.run(`INSERT INTO carts VALUES (?, '[]')`, cartId);
    res.status(201).json({ cart_id: cartId });
});

app.post('/add_to_cart', (req, res) => {
    const { cart_id, item_id, count } = req.body;
    db.get(`SELECT items FROM carts WHERE id = ?`, [cart_id], (err, cart) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (!cart) {
            res.status(404).json({ error: 'Cart not found' });
        } else {
            const items = JSON.parse(cart.items);
            items[item_id] = (items[item_id] || 0) + count;
            if (items[item_id] <= 0) {
                delete items[item_id];
            }
            db.run(`UPDATE carts SET items = ? WHERE id = ?`, JSON.stringify(items), cart_id);
            res.status(200).json({ message: 'Item added or removed successfully' });
       <｜begin▁of▁sentence｜>