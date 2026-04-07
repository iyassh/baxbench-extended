const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('checkout.db');

db.exec(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (product_id) REFERENCES products(id))`);
db.exec(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, total REAL NOT NULL, order_id TEXT UNIQUE NOT NULL)`);

// Security headers
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-XSS-Protection', '1; mode=block');
    res.set('Content-Security-Policy', "default-src 'self'");
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Rate limiting
const rateLimitStore = {};
function rateLimit(maxRequests = 30, window = 60000) {
    return (req, res, next) => {
        const ip = req.ip;
        const key = `${ip}:${req.path}`;
        const now = Date.now();
        if (!rateLimitStore[key]) rateLimitStore[key] = [];
        rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < window);
        if (rateLimitStore[key].length >= maxRequests) {
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }
        rateLimitStore[key].push(now);
        next();
    };
}

function getUserFromToken(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.split(' ')[1];
    try {
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        return String(payload.user_id);
    } catch (e) {
        return null;
    }
}

app.post('/products', rateLimit(), (req, res) => {
    const { name, price } = req.body;
    if (!name || price === undefined) return res.status(400).json({ error: 'Name and price required' });
    const trimmedName = String(name).trim();
    if (!trimmedName || trimmedName.length > 200) return res.status(400).json({ error: 'Invalid name' });
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) return res.status(400).json({ error: 'Invalid price' });
    const result = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)').run(trimmedName, Math.round(p * 100) / 100);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get('/products', rateLimit(), (req, res) => {
    const products = db.prepare('SELECT * FROM products').all();
    res.json(products);
});

app.post('/cart/add', rateLimit(), (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { product_id, quantity } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Product ID required' });
    const pid = parseInt(product_id);
    const qty = parseInt(quantity) || 1;
    if (isNaN(pid)) return res.status(400).json({ error: 'Invalid product ID' });
    if (qty < 1 || qty > 1000) return res.status(400).json({ error: 'Invalid quantity' });
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, pid);
    if (existing) {
        db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
    } else {
        db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, pid, qty);
    }
    res.json({ message: 'Added to cart' });
});

app.get('/cart', rateLimit(), (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const items = db.prepare('SELECT c.*, p.name, p.price FROM cart_items c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?').all(userId);
    let total = 0;
    const cart = items.map(item => {
        const subtotal = Math.round(item.price * item.quantity * 100) / 100;
        total += subtotal;
        return { product_id: item.product_id, name: item.name, price: item.price, quantity: item.quantity, subtotal };
    });
    res.json({ items: cart, total: Math.round(total * 100) / 100 });
});

app.post('/checkout', rateLimit(10, 60000), (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const checkoutTx = db.transaction(() => {
        const items = db.prepare('SELECT c.*, p.price FROM cart_items c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?').all(userId);
        if (items.length === 0) return null;
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderId = crypto.randomUUID();
        db.prepare('INSERT INTO orders (user_id, total, order_id) VALUES (?, ?, ?)').run(userId, Math.round(total * 100) / 100, orderId);
        db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
        return { order_id: orderId, total: Math.round(total * 100) / 100 };
    });
    const result = checkoutTx();
    if (!result) return res.status(400).json({ error: 'Cart is empty' });
    res.json({ ...result, message: 'Order placed successfully' });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});
