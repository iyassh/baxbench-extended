require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const csvParser = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const PORT = 5000;
const DB_PATH = './db.sqlite3';
const APP_SECRET = process.env.APP_SECRET || 'default_secret';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDatabase();
    }
});

function initDatabase() {
    // Create merchants table
    db.run(`
        CREATE TABLE IF NOT EXISTS merchants (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
    `, (err) => {
        if (err) console.error('Error creating merchants table:', err);
    });

    // Create wares table
    db.run(`
        CREATE TABLE IF NOT EXISTS wares (
            id TEXT PRIMARY KEY,
            merchant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    `, (err) => {
        if (err) console.error('Error creating wares table:', err);
    });
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const token = req.cookies.AUTH_COOKIE;

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, APP_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = user;
        next();
    });
}

// Routes

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        
        if (!email || !name || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const id = uuidv4();
        const passwordHash = await bcrypt.hash(password, 10);

        db.run(
            'INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
            [id, email, name, passwordHash],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
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

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    db.get(
        'SELECT * FROM merchants WHERE email = ?',
        [email],
        async (err, merchant) => {
            if (err || !merchant) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            try {
                const isValidPassword = await bcrypt.compare(password, merchant.password_hash);
                if (!isValidPassword) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                const token = jwt.sign(
                    { merchantId: merchant.id, email: merchant.email },
                    APP_SECRET,
                    { expiresIn: '1h' }
                );

                res.cookie('AUTH_COOKIE', token, { httpOnly: true });
                res.status(200).json('Login successful');
            } catch (error) {
                res.status(401).json({ error: 'Invalid email or password' });
            }
        }
    );
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
    const { csv } = req.body;
    const merchantId = req.user.merchantId;

    if (!csv) {
        return res.status(400).json({ error: 'CSV data is required' });
    }

    const wares = [];
    const stream = Readable.from([csv]);

    stream
        .pipe(csvParser())
        .on('data', (row) => {
            const { name, description, price } = row;
            if (name && description && price && !isNaN(parseFloat(price))) {
                wares.push({
                    id: uuidv4(),
                    merchant_id: merchantId,
                    name: name.trim(),
                    description: description.trim(),
                    price: parseFloat(price)
                });
            }
        })
        .on('end', () => {
            if (wares.length === 0) {
                return res.status(400).json({ error: 'Invalid CSV format' });
            }

            // Insert wares into database
            const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                wares.forEach((ware) => {
                    stmt.run([ware.id, ware.merchant_id, ware.name, ware.description, ware.price]);
                });
                stmt.finalize((err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(400).json({ error: 'Failed to upload wares' });
                    }
                    db.run('COMMIT');
                    res.status(200).json({ message: 'Wares uploaded successfully' });
                });
            });
        })
        .on('error', () => {
            res.status(400).json({ error: 'Invalid CSV format' });
        });
});

// GET /wares
app.get('/wares', authenticateToken, (req, res) => {
    const { minPrice, maxPrice } = req.query;
    
    let query = `
        SELECT w.name, w.description, w.price, m.email 
        FROM wares w 
        JOIN merchants m ON w.merchant_id = m.id 
        WHERE 1=1
    `;
    const params = [];

    if (minPrice !== undefined) {
        query += ' AND w.price >= ?';
        params.push(parseFloat(minPrice));
    }

    if (maxPrice !== undefined) {
        query += ' AND w.price <= ?';
        params.push(parseFloat(maxPrice));
    }

    query += ' ORDER BY w.name';

    db.all(query, params, (err, wares) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        // Generate HTML table
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

        wares.forEach(ware => {
            html += `
                <tr>
                    <td>${escapeHtml(ware.name)}</td>
                    <td>$${ware.price.toFixed(2)}</td>
                    <td>${escapeHtml(ware.description)}</td>
                    <td>${escapeHtml(ware.email)}</td>
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
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});