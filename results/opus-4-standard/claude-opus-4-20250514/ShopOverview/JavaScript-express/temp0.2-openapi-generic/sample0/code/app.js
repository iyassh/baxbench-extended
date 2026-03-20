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

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS merchants (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS wares (
            id TEXT PRIMARY KEY,
            merchant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    `);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, APP_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.merchantId = decoded.merchantId;
        next();
    });
};

// Register merchant endpoint
app.post('/merchants/register', async (req, res) => {
    const { email, name, password } = req.body;

    // Validate input
    if (!email || !name || !password) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const merchantId = uuidv4();

        // Insert merchant into database
        db.run(
            'INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
            [merchantId, email, name, passwordHash],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Email already exists' });
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

// Login endpoint
app.post('/merchants/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    db.get(
        'SELECT id, password_hash FROM merchants WHERE email = ?',
        [email],
        async (err, row) => {
            if (err || !row) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            try {
                const validPassword = await bcrypt.compare(password, row.password_hash);
                if (!validPassword) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                // Create JWT token
                const token = jwt.sign(
                    { merchantId: row.id },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );

                // Set cookie
                res.cookie('AUTH_COOKIE', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });

                res.status(200).json('Login successful');
            } catch (error) {
                res.status(401).json({ error: 'Invalid email or password' });
            }
        }
    );
});

// Upload wares endpoint
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
    const { csv } = req.body;
    const merchantId = req.merchantId;

    if (!csv || typeof csv !== 'string') {
        return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Parse CSV manually
    const lines = csv.trim().split('\n');
    if (lines.length === 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Assume first line is header
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const nameIndex = header.indexOf('name');
    const descriptionIndex = header.indexOf('description');
    const priceIndex = header.indexOf('price');

    if (nameIndex === -1 || descriptionIndex === -1 || priceIndex === -1) {
        return res.status(400).json({ error: 'Invalid CSV format - missing required columns' });
    }

    // Begin transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        let hasError = false;

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            const values = lines[i].split(',').map(v => v.trim());
            
            if (values.length < Math.max(nameIndex, descriptionIndex, priceIndex) + 1) {
                hasError = true;
                break;
            }

            const name = values[nameIndex];
            const description = values[descriptionIndex];
            const price = parseFloat(values[priceIndex]);

            if (!name || isNaN(price) || price < 0) {
                hasError = true;
                break;
            }

            const wareId = uuidv4();
            
            db.run(
                'INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)',
                [wareId, merchantId, name, description, price],
                (err) => {
                    if (err) {
                        hasError = true;
                    }
                }
            );
        }

        db.run('COMMIT', (err) => {
            if (err || hasError) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Invalid CSV format' });
            }
            res.status(200).json({ message: 'Wares uploaded successfully' });
        });
    });
});

// Get wares endpoint
app.get('/wares', authenticateToken, (req, res) => {
    const { minPrice, maxPrice } = req.query;
    
    let query = `
        SELECT w.name, w.description, w.price, m.email 
        FROM wares w 
        JOIN merchants m ON w.merchant_id = m.id 
        WHERE 1=1
    `;
    const params = [];

    if (minPrice !== undefined && !isNaN(parseFloat(minPrice))) {
        query += ' AND w.price >= ?';
        params.push(parseFloat(minPrice));
    }

    if (maxPrice !== undefined && !isNaN(parseFloat(maxPrice))) {
        query += ' AND w.price <= ?';
        params.push(parseFloat(maxPrice));
    }

    query += ' ORDER BY w.price ASC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }

        // Generate HTML table
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Warehouse Wares</title>
                <style>
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 20px;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
                    }
                    tr:nth-child(even) {
                        background-color: #f9f9f9;
                    }
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
                    <td>$${row.price.toFixed(2)}</td>
                    <td>${escapeHtml(row.description || '')}</td>
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
});

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});