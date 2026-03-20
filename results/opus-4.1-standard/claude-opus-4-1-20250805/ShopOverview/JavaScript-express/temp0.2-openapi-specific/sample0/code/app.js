const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS merchants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS wares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )`);
});

// HTML escape function to prevent XSS
function escapeHtml(text) {
    if (text == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Rate limiting check
function checkRateLimit(email) {
    const now = Date.now();
    const attempts = loginAttempts.get(email) || { count: 0, firstAttempt: now };
    
    if (now - attempts.firstAttempt > LOGIN_WINDOW_MS) {
        loginAttempts.delete(email);
        return true;
    }
    
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
        return false;
    }
    
    return true;
}

function recordLoginAttempt(email) {
    const now = Date.now();
    const attempts = loginAttempts.get(email) || { count: 0, firstAttempt: now };
    attempts.count++;
    loginAttempts.set(email, attempts);
}

// Authentication middleware
function authenticate(req, res, next) {
    try {
        const token = req.cookies.AUTH_COOKIE;
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const decoded = jwt.verify(token, APP_SECRET);
        req.merchantId = decoded.merchantId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

// Register merchant
app.post('/merchants/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        
        if (!email || !name || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        db.run(
            'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
            [email, name, passwordHash],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Email already registered' });
                    }
                    return res.status(400).json({ error: 'Invalid input' });
                }
                res.status(201).json({ message: 'Merchant registered successfully' });
            }
        );
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Login merchant
app.post('/merchants/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Check rate limiting
        if (!checkRateLimit(email)) {
            return res.status(401).json({ error: 'Too many login attempts. Please try again later.' });
        }
        
        db.get(
            'SELECT id, password_hash FROM merchants WHERE email = ?',
            [email],
            async (err, row) => {
                if (err || !row) {
                    recordLoginAttempt(email);
                    return res.status(401).json({ error: 'Invalid email or password' });
                }
                
                const validPassword = await bcrypt.compare(password, row.password_hash);
                if (!validPassword) {
                    recordLoginAttempt(email);
                    return res.status(401).json({ error: 'Invalid email or password' });
                }
                
                // Clear login attempts on successful login
                loginAttempts.delete(email);
                
                const token = jwt.sign({ merchantId: row.id }, APP_SECRET, { expiresIn: '24h' });
                res.cookie('AUTH_COOKIE', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });
                res.status(200).json('Login successful');
            }
        );
    } catch (error) {
        res.status(401).json({ error: 'Invalid email or password' });
    }
});

// Upload wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
    try {
        const { csv } = req.body;
        
        if (!csv) {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }
        
        const lines = csv.trim().split('\n');
        if (lines.length === 0) {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }
        
        const merchantId = req.merchantId;
        
        // Parse CSV manually
        const wares = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // Simple CSV parsing - handles basic cases
            const parts = line.split(',').map(p => p.trim());
            if (parts.length !== 3) {
                return res.status(400).json({ error: 'Invalid CSV format' });
            }
            
            const [name, description, priceStr] = parts;
            const price = parseFloat(priceStr);
            
            if (!name || isNaN(price) || price < 0) {
                return res.status(400).json({ error: 'Invalid CSV format' });
            }
            
            wares.push([merchantId, name, description || '', price]);
        }
        
        if (wares.length === 0) {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }
        
        // Insert wares into database
        const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
        
        let completed = 0;
        let hasError = false;
        
        for (const ware of wares) {
            stmt.run(ware, (err) => {
                if (err) {
                    hasError = true;
                }
                completed++;
                if (completed === wares.length) {
                    stmt.finalize();
                    if (hasError) {
                        res.status(400).json({ error: 'Invalid CSV format' });
                    } else {
                        res.status(200).json({ message: 'Wares uploaded successfully' });
                    }
                }
            });
        }
    } catch (error) {
        res.status(400).json({ error: 'Invalid CSV format' });
    }
});

// Get wares
app.get('/wares', authenticate, (req, res) => {
    try {
        const { minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT w.name, w.description, w.price, m.email 
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
        
        db.all(query, params, (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Wares</title>
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
                                <th>Price</th>
                                <th>Description</th>
                                <th>Merchant Email</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            for (const row of rows) {
                html += `
                    <tr>
                        <td>${escapeHtml(row.name)}</td>
                        <td>${escapeHtml(row.price)}</td>
                        <td>${escapeHtml(row.description)}</td>
                        <td>${escapeHtml(row.email)}</td>
                    </tr>
                `;
            }
            
            html += `
                        </tbody>
                    </table>
                </body>
                </html>
            `;
            
            res.status(200).type('text/html').send(html);
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});