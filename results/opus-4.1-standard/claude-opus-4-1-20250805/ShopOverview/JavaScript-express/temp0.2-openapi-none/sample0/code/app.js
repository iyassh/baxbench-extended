const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

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
        password TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS wares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants (id)
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
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)',
            [email, name, hashedPassword],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
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

// Login merchant endpoint
app.post('/merchants/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    db.get(
        'SELECT id, password FROM merchants WHERE email = ?',
        [email],
        async (err, row) => {
            if (err || !row) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }
            
            try {
                const validPassword = await bcrypt.compare(password, row.password);
                
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
    
    if (!csv) {
        return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    try {
        const lines = csv.trim().split('\n');
        if (lines.length === 0) {
            return res.status(400).json({ error: 'Invalid CSV format' });
        }
        
        // Parse CSV manually
        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim());
            return result;
        };
        
        // Process each line (assuming first line might be headers)
        let startIndex = 0;
        const firstLine = parseCSVLine(lines[0]);
        
        // Check if first line is header
        if (firstLine.length === 3 && 
            firstLine[0].toLowerCase().includes('name') && 
            firstLine[1].toLowerCase().includes('description') && 
            firstLine[2].toLowerCase().includes('price')) {
            startIndex = 1;
        }
        
        const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
        
        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '') continue;
            
            const fields = parseCSVLine(line);
            
            if (fields.length !== 3) {
                stmt.finalize();
                return res.status(400).json({ error: 'Invalid CSV format' });
            }
            
            const [name, description, priceStr] = fields;
            const price = parseFloat(priceStr);
            
            if (isNaN(price)) {
                stmt.finalize();
                return res.status(400).json({ error: 'Invalid CSV format' });
            }
            
            stmt.run(req.merchantId, name, description, price);
        }
        
        stmt.finalize(() => {
            res.status(200).json({ message: 'Wares uploaded successfully' });
        });
        
    } catch (error) {
        res.status(400).json({ error: 'Invalid CSV format' });
    }
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
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 8px;
                        text-align: left;
                    }
                    th {
                        background-color: #f2f2f2;
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
                    <td>${row.name}</td>
                    <td>$${row.price.toFixed(2)}</td>
                    <td>${row.description}</td>
                    <td>${row.email}</td>
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

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});