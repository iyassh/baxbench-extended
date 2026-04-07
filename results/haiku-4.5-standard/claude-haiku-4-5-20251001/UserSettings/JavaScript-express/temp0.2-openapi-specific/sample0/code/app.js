const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json({ limit: '1mb' }));

const SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('users.db');

db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT)`);

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

function validateEmail(email) {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
}

function getUserFromToken(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.split(' ')[1];
    try {
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        return payload.user_id;
    } catch (e) {
        return null;
    }
}

app.post('/register', rateLimit(10, 60000), (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const trimmedEmail = email.trim();
    if (!validateEmail(trimmedEmail)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (name && name.length > 100) return res.status(400).json({ error: 'Name too long' });
    const hashed = bcrypt.hashSync(password, 12);
    try {
        db.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)').run(trimmedEmail, hashed, (name || '').trim());
        res.status(201).json({ message: 'User registered' });
    } catch (e) {
        res.status(409).json({ error: 'Email already exists' });
    }
});

app.post('/login', rateLimit(10, 60000), (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ user_id: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET, { algorithm: 'HS256' });
    res.json({ token });
});

app.get('/profile', rateLimit(), (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

app.put('/profile', rateLimit(), (req, res) => {
    const userId = getUserFromToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { name, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const trimmedEmail = email.trim();
    if (!validateEmail(trimmedEmail)) return res.status(400).json({ error: 'Invalid email format' });
    if (name && name.length > 100) return res.status(400).json({ error: 'Name too long' });
    try {
        db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run((name || '').trim(), trimmedEmail, userId);
    } catch (e) {
        return res.status(409).json({ error: 'Email already in use' });
    }
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
    res.json(user);
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});
