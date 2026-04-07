const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Reset tokens table
    db.run(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            used INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    `);
});

const APP_SECRET = process.env.APP_SECRET || 'fallback-secret';

// Helper function to validate email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Register endpoint
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password || !isValidEmail(email)) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    try {
        // Check if user already exists
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (existingUser) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Insert user
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                [email, passwordHash], function(err) {
                if (err) reject(err);
                resolve(this.lastID);
            });
        });
        
        res.status(201).json({ message: 'Registration successful' });
        
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: 'Email already in use or invalid data' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    try {
        // Get user from database
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Generate JWT token
        const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });
        
        res.status(200).json({ 
            token: token,
            message: 'Login successful' 
        });
        
    } catch (error) {
        console.error(error);
        res.status(401).json({ message: 'Invalid email or password' });
    }
});

// Forgot password endpoint
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(404).json({ message: 'Email not found' });
    }
    
    try {
        // Check if user exists
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (!user) {
            return res.status(404).json({ message: 'Email not found' });
        }
        
        // Generate reset token
        const resetToken = uuidv4();
        
        // Store reset token
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO reset_tokens (token, user_id) VALUES (?, ?)', 
                [resetToken, user.id], function(err) {
                if (err) reject(err);
                resolve(this.lastID);
            });
        });
        
        res.status(200).json({ 
            message: 'Password reset token generated',
            reset_token: resetToken
        });
        
    } catch (error) {
        console.error(error);
        res.status(404).json({ message: 'Email not found' });
    }
});

// Reset password endpoint
app.post('/reset-password', async (req, res) => {
    const { token, new_password } = req.body;
    
    if (!token || !new_password) {
        return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    try {
        // Verify reset token
        const resetToken = await new Promise((resolve, reject) => {
            db.get('SELECT token, user_id, created_at, used FROM reset_tokens WHERE token = ?', [token], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
        
        if (!resetToken || resetToken.used) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }
        
        // Check if token is expired (24 hours)
        const tokenAge = Date.now() - new Date(resetToken.created_at).getTime();
        if (tokenAge > 24 * 60 * 60 * 1000) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }
        
        // Hash new password
        const passwordHash = await bcrypt.hash(new_password, 10);
        
        // Update user password
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET password_hash = ? WHERE id = ?', 
                [passwordHash, resetToken.user_id], function(err) {
                if (err) reject(err);
                resolve();
            });
        });
        
        // Mark token as used
        await new Promise((resolve, reject) => {
            db.run('UPDATE reset_tokens SET used = 1 WHERE token = ?', [token], function(err) {
                if (err) reject(err);
                resolve();
            });
        });
        
        res.status(200).json({ message: 'Password reset successful' });
        
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: 'Invalid or expired token' });
    }
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});