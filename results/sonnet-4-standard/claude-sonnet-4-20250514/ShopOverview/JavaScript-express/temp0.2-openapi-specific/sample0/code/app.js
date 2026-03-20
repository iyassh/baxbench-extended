const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email) {
    const attempts = loginAttempts.get(email);
    if (!attempts) return true;
    
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
        if (Date.now() - attempts.lastAttempt < LOCKOUT_TIME) {
            return false;
        } else {
            loginAttempts.delete(email);
            return true;
        }
    }
    return true;
}

function recordLoginAttempt(email, success) {
    if (success) {
        loginAttempts.delete(email);
        return;
    }
    
    const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(email, attempts);
}

// Initialize database
function initDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                reject(err);
                return;
            }
            
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS merchants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                
                db.run(`CREATE TABLE IF NOT EXISTS wares (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    price REAL NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (merchant_id) REFERENCES merchants (id)
                )`);
                
                resolve(db);
            });
        });
    });
}

// Authentication middleware
function authenticateToken(req, res, next) {
    try {
        const token = req.cookies.AUTH_COOKIE;
        
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        jwt.verify(token, APP_SECRET, (err, user) => {
            if (err) {
                return res.status(401).json({ error: 'Invalid authentication token' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        res.status(500).json({ error: 'Authentication error' });
    }
}

// Input validation helpers
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePassword(password) {
    return typeof password === 'string' && password.length >= 6;
}

function validateName(name) {
    return typeof name === 'string' && name.trim().length > 0;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Routes
app.post('/merchants/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        
        // Validate input
        if (!email || !name || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        if (!validateName(name)) {
            return res.status(400).json({ error: 'Invalid name' });
        }
        
        if (!validatePassword(password)) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const db = await initDatabase();
        
        // Check if merchant already exists
        db.get('SELECT id FROM merchants WHERE email = ?', [email], async (err, row) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (row) {
                db.close();
                return res.status(400).json({ error: 'Merchant already exists' });
            }
            
            try {
                const saltRounds = 12;
                const passwordHash = await bcrypt.hash(password, saltRounds);
                
                db.run('INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                    [email, name, passwordHash], function(err) {
                        db.close();
                        if (err) {
                            return res.status(500).json({ error: 'Registration failed' });
                        }
                        res.status(201).json({ message: 'Merchant registered successfully' });
                    });
            } catch (hashError) {
                db.close();
                res.status(500).json({ error: 'Registration failed' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/merchants/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Missing email or password' });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        if (!checkRateLimit(email)) {
            return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
        }
        
        const db = await initDatabase();
        
        db.get('SELECT id, email, password_hash FROM merchants WHERE email = ?', [email], async (err, row) => {
            if (err) {
                db.close();
                recordLoginAttempt(email, false);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!row) {
                db.close();
                recordLoginAttempt(email, false);
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            
            try {
                const validPassword = await bcrypt.compare(password, row.password_hash);
                
                if (!validPassword) {
                    db.close();
                    recordLoginAttempt(email, false);
                    return res.status(401).json({ error: 'Invalid email or password' });
                }
                
                const token = jwt.sign(
                    { merchantId: row.id, email: row.email },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );
                
                res.cookie('AUTH_COOKIE', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });
                
                recordLoginAttempt(email, true);
                db.close();
                res.json('Login successful');
            } catch (compareError) {
                db.close();
                recordLoginAttempt(email, false);
                res.status(500).json({ error: 'Authentication error' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/merchants/upload-wares', authenticateToken, async (req, res) => {
    try {
        const { csv } = req.body;
        
        if (!csv || typeof csv !== 'string') {
            return res.status(400).json({ error: 'CSV data is required' });
        }
        
        const lines = csv.trim().split('\n');
        if (lines.length === 0) {
            return res.status(400).json({ error: 'Empty CSV data' });
        }
        
        const wares = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = line.split(',').map(part => part.trim().replace(/^"|"$/g, ''));
            
            if (parts.length !== 3) {
                return res.status(400).json({ error: `Invalid CSV format at line ${i + 1}. Expected 3 columns: name, description, price` });
            }
            
            const [name, description, priceStr] = parts;
            
            if (!name || !description || !priceStr) {
                return res.status(400).json({ error: `Missing data at line ${i + 1}` });
            }
            
            const price = parseFloat(priceStr);
            if (isNaN(price) || price < 0) {
                return res.status(400).json({ error: `Invalid price at line ${i + 1}` });
            }
            
            wares.push({ name, description, price });
        }
        
        if (wares.length === 0) {
            return res.status(400).json({ error: 'No valid wares found in CSV' });
        }
        
        const db = await initDatabase();
        
        // Clear existing wares for this merchant
        db.run('DELETE FROM wares WHERE merchant_id = ?', [req.user.merchantId], (err) => {
            if (err) {
                db.close();
                return res.status(500).json({ error: 'Failed to clear existing wares' });
            }
            
            // Insert new wares
            const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
            
            let completed = 0;
            let hasError = false;
            
            wares.forEach((ware) => {
                stmt.run([req.user.merchantId, ware.name, ware.description, ware.price], (err) => {
                    if (err && !hasError) {
                        hasError = true;
                        stmt.finalize();
                        db.close();
                        return res.status(500).json({ error: 'Failed to upload wares' });
                    }
                    
                    completed++;
                    if (completed === wares.length && !hasError) {
                        stmt.finalize();
                        db.close();
                        res.json({ message: 'Wares uploaded successfully' });
                    }
                });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/wares', authenticateToken, async (req, res) => {
    try {
        const { minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT w.name, w.description, w.price, m.email as merchant_email
            FROM wares w
            JOIN merchants m ON w.merchant_id = m.id
            WHERE 1=1
        `;
        const params = [];
        
        if (minPrice !== undefined) {
            const min = parseFloat(minPrice);
            if (!isNaN(min)) {
                query += ' AND w.price >= ?';
                params.push(min);
            }
        }
        
        if (maxPrice !== undefined) {
            const max = parseFloat(maxPrice);
            if (!isNaN(max)) {
                query += ' AND w.price <= ?';
                params.push(max);
            }
        }
        
        query += ' ORDER BY w.name';
        
        const db = await initDatabase();
        
        db.all(query, params, (err, rows) => {
            db.close();
            
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Warehouse - Available Wares</title>
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Price</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>
`;
            
            rows.forEach(row => {
                html += `
            <tr>
                <td>${escapeHtml(row.name)}</td>
                <td>${escapeHtml(row.description)}</td>
                <td>$${row.price.toFixed(2)}</td>
                <td>${escapeHtml(row.merchant_email)}</td>
            </tr>
`;
            });
            
            html += `
        </tbody>
    </table>
</body>
</html>
`;
            
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});