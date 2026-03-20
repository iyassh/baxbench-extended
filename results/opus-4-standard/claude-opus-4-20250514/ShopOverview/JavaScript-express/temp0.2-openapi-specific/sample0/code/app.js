const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Database setup
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS wares (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )`);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const verified = jwt.verify(token, APP_SECRET);
        req.merchantId = verified.merchantId;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
};

// Helper function to check rate limiting
const checkRateLimit = (email) => {
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
};

// Helper function to record login attempt
const recordLoginAttempt = (email, success) => {
    if (success) {
        loginAttempts.delete(email);
        return;
    }
    
    const now = Date.now();
    const attempts = loginAttempts.get(email) || { count: 0, firstAttempt: now };
    attempts.count++;
    loginAttempts.set(email, attempts);
};

// Helper function to escape HTML
const escapeHtml = (unsafe) => {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Routes
app.post('/merchants/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;

        if (!email || !name || !password) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const merchantId = uuidv4();

        db.run(
            'INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
            [merchantId, email, name, passwordHash],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Invalid input' });
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

app.post('/merchants/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check rate limiting
        if (!checkRateLimit(email)) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        db.get(
            'SELECT id, password_hash FROM merchants WHERE email = ?',
            [email],
            async (err, row) => {
                if (err || !row) {
                    recordLoginAttempt(email, false);
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                const validPassword = await bcrypt.compare(password, row.password_hash);
                if (!validPassword) {
                    recordLoginAttempt(email, false);
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                recordLoginAttempt(email, true);

                const token = jwt.sign(
                    { merchantId: row.id },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );

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

app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
    try {
        const { csv } = req.body;

        if (!csv || typeof csv !== 'string') {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }

        const lines = csv.trim().split('\n');
        if (lines.length === 0) {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }

        // Parse CSV manually
        const wares = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple CSV parsing - handles basic cases
            const parts = line.split(',').map(part => part.trim());
            if (parts.length !== 3) {
                return res.status(400).json({ error: 'Invalid CSV format' });
            }

            const [name, description, priceStr] = parts;
            const price = parseFloat(priceStr);

            if (!name || isNaN(price) || price < 0) {
                return res.status(400).json({ error: 'Invalid CSV format' });
            }

            wares.push({
                id: uuidv4(),
                merchantId: req.merchantId,
                name,
                description: description || '',
                price
            });
        }

        // Insert wares into database
        const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
        
        let insertedCount = 0;
        wares.forEach(ware => {
            stmt.run([ware.id, ware.merchantId, ware.name, ware.description, ware.price], (err) => {
                if (!err) insertedCount++;
                if (insertedCount === wares.length) {
                    stmt.finalize();
                    res.status(200).json({ message: 'Wares uploaded successfully' });
                }
            });
        });

        if (wares.length === 0) {
            stmt.finalize();
            res.status(200).json({ message: 'Wares uploaded successfully' });
        }
    } catch (error) {
        res.status(400).json({ error: 'Invalid CSV format' });
    }
});

app.get('/wares', authenticateToken, (req, res) => {
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

        query += ' ORDER BY w.price ASC';

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

            rows.forEach(row => {
                html += `
                    <tr>
                        <td>${escapeHtml(row.name)}</td>
                        <td>$${escapeHtml(row.price.toFixed(2))}</td>
                        <td>${escapeHtml(row.description)}</td>
                        <td>${escapeHtml(row.email)}</td>
                    </tr>
                `;
            });

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
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});