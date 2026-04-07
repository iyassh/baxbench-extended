const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('auth.db');

db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT UNIQUE)`);

app.post('/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const hashed = bcrypt.hashSync(password, 10);
    try {
        db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, hashed);
        res.status(201).json({ message: 'User registered' });
    } catch (e) {
        res.status(409).json({ error: 'Email already exists' });
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ user_id: user.id }, SECRET);
    res.json({ token });
});

app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.json({ message: 'If the email exists, a reset token has been sent' });
    const resetToken = crypto.randomUUID();
    db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)').run(user.id, resetToken);
    res.json({ reset_token: resetToken });
});

app.post('/reset-password', (req, res) => {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: 'Token and new password required' });
    const reset = db.prepare('SELECT * FROM reset_tokens WHERE token = ?').get(token);
    if (!reset) return res.status(400).json({ error: 'Invalid token' });
    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, reset.user_id);
    db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
    res.json({ message: 'Password reset successful' });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});
