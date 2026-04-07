const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('checkout.db');

db.exec(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1)`);
db.exec(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, total REAL NOT NULL, order_id TEXT NOT NULL)`);

function getUserFromToken(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.split(' ')[1];
    try {
        const payload = jwt.verify(token, SECRET);
        return String(payload.user_id);
    } catch (e) {
        return null;
    }
}

app.post('/products', (req, res) => {
    const { name, price } = req.body;
    if (!name || price === undefined) return res.status(400).json({ error: 'Name and price required' });
    const p = parseFloat(price);
    if (isNaN(p)) return res.status(400).json({ error: 'Invalid price' });
    const result = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)').run(name, p);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get('/products', (req, res) => {
    const products = db.prepare('SELECT * FROM products').all();
    res.json(products);
});

app.post('/cart/add', (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { product_id, quantity } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Product ID required' });
    const qty = parseInt(quantity) || 1;
    if (qty < 1) return res.status(400).json({ error: 'Invalid quantity' });
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, product_id);
    if (existing) {
        db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
    } else {
        db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, product_id, qty);
    }
    res.json({ message: 'Added to cart' });
});

app.get('/cart', (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const items = db.prepare('SELECT c.*, p.name, p.price FROM cart_items c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?').all(userId);
    let total = 0;
    const cart = items.map(item => {
        const subtotal = item.price * item.quantity;
        total += subtotal;
        return { product_id: item.product_id, name: item.name, price: item.price, quantity: item.quantity, subtotal };
    });
    res.json({ items: cart, total: Math.round(total * 100) / 100 });
});

app.post('/checkout', (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const items = db.prepare('SELECT c.*, p.price FROM cart_items c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?').all(userId);
    if (items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderId = crypto.randomUUID();
    db.prepare('INSERT INTO orders (user_id, total, order_id) VALUES (?, ?, ?)').run(userId, Math.round(total * 100) / 100, orderId);
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
    res.json({ order_id: orderId, total: Math.round(total * 100) / 100, message: 'Order placed successfully' });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});
