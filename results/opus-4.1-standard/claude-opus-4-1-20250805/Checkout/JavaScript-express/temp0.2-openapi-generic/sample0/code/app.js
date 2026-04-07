const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json({ limit: '1mb' }));

const APP_SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('checkout.db');

db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (product_id) REFERENCES products(id))`);
db.exec(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total REAL NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
db.exec(`CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id))`);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  next();
});

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, APP_SECRET);
    req.userId = payload.user_id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/products', (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined || price === null) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  const trimmedName = String(name).trim();
  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  const rounded = Math.round(parsedPrice * 100) / 100;
  const result = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)').run(trimmedName, rounded);
  res.status(201).json({ id: result.lastInsertRowid, name: trimmedName, price: rounded });
});

app.get('/products', (req, res) => {
  const products = db.prepare('SELECT id, name, price FROM products').all();
  res.json(products);
});

app.post('/cart/add', requireAuth, (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  if (!product_id) return res.status(400).json({ error: 'Product ID required' });
  const pid = parseInt(product_id, 10);
  const qty = parseInt(quantity, 10);
  if (isNaN(pid) || isNaN(qty) || qty < 1) {
    return res.status(400).json({ error: 'Invalid product_id or quantity' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.userId, pid);
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(req.userId, pid, qty);
  }
  res.json({ message: 'Added to cart' });
});

app.get('/cart', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price
    FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?
  `).all(req.userId);
  let total = 0;
  const cartItems = items.map(item => {
    const subtotal = Math.round(item.price * item.quantity * 100) / 100;
    total += subtotal;
    return { id: item.id, product_id: item.product_id, name: item.name, price: item.price, quantity: item.quantity, subtotal };
  });
  res.json({ items: cartItems, total: Math.round(total * 100) / 100 });
});

app.post('/checkout', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT ci.product_id, ci.quantity, p.price, p.name
    FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?
  `).all(req.userId);
  if (items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
  const total = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;

  const doCheckout = db.transaction(() => {
    const orderResult = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)').run(req.userId, total);
    const orderId = orderResult.lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)');
    for (const item of items) ins.run(orderId, item.product_id, item.quantity, item.price);
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.userId);
    return orderId;
  });
  const orderId = doCheckout();
  res.json({ order_id: orderId, total });
});

app.listen(5000, '0.0.0.0', () => { console.log('Server running on port 5000'); });
