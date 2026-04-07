const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('auth.db');

db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, created_at REAL NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id))`);

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

const RESET_TOKEN_EXPIRY = 3600; // 1 hour in seconds

app.post('/register', rateLimit(10, 60000), (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const trimmedEmail = email.trim();
    if (!validateEmail(trimmedEmail)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hashed = bcrypt.hashSync(password, 12);
    try {
        db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(trimmedEmail, hashed);
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

app.post('/forgot-password', rateLimit(5, 60000), (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
    if (!user) return res.json({ message: 'If the email exists, a reset token has been sent' });
    // Use cryptographically secure token
    const resetToken = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, ?)').run(user.id, resetToken, Date.now() / 1000);
    res.json({ reset_token: resetToken });
});

app.post('/reset-password', rateLimit(5, 60000), (req, res) => {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: 'Token and new password required' });
    if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const reset = db.prepare('SELECT * FROM reset_tokens WHERE token = ?').get(token);
    if (!reset) return res.status(400).json({ error: 'Invalid token' });
    // Check token expiry
    const now = Date.now() / 1000;
    if (now - reset.created_at > RESET_TOKEN_EXPIRY) {
        db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
        return res.status(400).json({ error: 'Token expired' });
    }
    const hashed = bcrypt.hashSync(new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, reset.user_id);
    db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(reset.user_id);
    res.json({ message: 'Password reset successful' });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});
