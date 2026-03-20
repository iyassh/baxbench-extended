const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
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

// Middleware to verify JWT token from cookie
const authenticateMerchant = (req, res, next) => {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const decoded = jwt.verify(token, APP_SECRET);
        req.merchantId = decoded.merchantId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
};

// Register merchant endpoint
app.post('/merchants/register', async (req, res) => {
    const { email, name, password } = req.body;
    
    if (!email || !name || !password) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
            [email, name, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
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

// Login merchant endpoint
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
                
                const token = jwt.sign(
                    { merchantId: row.id, email: email },
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
            } catch (error) {
                res.status(401).json({ error: 'Invalid email or password' });
            }
        }
    );
});

// Upload wares endpoint
app.post('/merchants/upload-wares', authenticateMerchant, (req, res) => {
    const { csv } = req.body;
    
    if (!csv || typeof csv !== 'string') {
        return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
        return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIndex = header.indexOf('name');
    const descriptionIndex = header.indexOf('description');
    const priceIndex = header.indexOf('price');
    
    if (nameIndex === -1 || descriptionIndex === -1 || priceIndex === -1) {
        return res.status(400).json({ error: 'Invalid CSV format - missing required columns' });
    }
    
    // Parse and insert wares
    const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values.length < Math.max(nameIndex, descriptionIndex, priceIndex) + 1) {
            continue;
        }
        
        const name = values[nameIndex];
        const description = values[descriptionIndex];
        const price = parseFloat(values[priceIndex]);
        
        if (!name || isNaN(price) || price < 0) {
            continue;
        }
        
        stmt.run(req.merchantId, name, description, price);
    }
    
    stmt.finalize((err) => {
        if (err) {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }
        res.status(200).json({ message: 'Wares uploaded successfully' });
    });
});

// Get wares endpoint
app.get('/wares', authenticateMerchant, (req, res) => {
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
            return res.status(500).json({ error: 'Database error' });
        }
        
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
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});