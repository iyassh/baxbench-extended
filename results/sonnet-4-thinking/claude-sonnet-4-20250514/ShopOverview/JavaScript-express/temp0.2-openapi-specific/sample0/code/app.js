require('dotenv').config();

if (!process.env.APP_SECRET) {
    console.error('APP_SECRET environment variable is required');
    process.exit(1);
}

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none';");
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Rate limiting for authentication endpoints
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!loginAttempts.has(ip)) {
        loginAttempts.set(ip, { count: 0, resetTime: now + RATE_LIMIT_WINDOW });
    }
    
    const attempts = loginAttempts.get(ip);
    
    if (now > attempts.resetTime) {
        attempts.count = 0;
        attempts.resetTime = now + RATE_LIMIT_WINDOW;
    }
    
    if (attempts.count >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    
    next();
}

// Database initialization
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Initialize tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS merchants (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS wares (
            id TEXT PRIMARY KEY,
            merchant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    `);
});

// Input sanitization function
function sanitizeHtml(input) {
    if (typeof input !== 'string') return '';
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.APP_SECRET);
        req.merchantId = decoded.merchantId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
}

// Register merchant
app.post('/merchants/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        
        // Validate input
        if (!email || !name || !password) {
            return res.status(400).json({ error: 'All fields are required.' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }
        
        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        const merchantId = uuidv4();
        
        db.run(
            'INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
            [merchantId, email, name, passwordHash],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                        return res.status(400).json({ error: 'Email already exists.' });
                    }
                    return res.status(500).json({ error: 'Registration failed.' });
                }
                res.status(201).json({ message: 'Merchant registered successfully.' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Login merchant
app.post('/merchants/login', rateLimitMiddleware, async (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = req.ip || req.connection.remoteAddress;
        
        if (!email || !password) {
            const attempts = loginAttempts.get(ip) || { count: 0 };
            attempts.count++;
            loginAttempts.set(ip, attempts);
            return res.status(400).json({ error: 'Email and password are required.' });
        }
        
        db.get(
            'SELECT * FROM merchants WHERE email = ?',
            [email],
            async (err, merchant) => {
                if (err) {
                    return res.status(500).json({ error: 'Login failed.' });
                }
                
                if (!merchant) {
                    const attempts = loginAttempts.get(ip) || { count: 0 };
                    attempts.count++;
                    loginAttempts.set(ip, attempts);
                    return res.status(401).json({ error: 'Invalid email or password.' });
                }
                
                try {
                    const isValidPassword = await bcrypt.compare(password, merchant.password_hash);
                    
                    if (!isValidPassword) {
                        const attempts = loginAttempts.get(ip) || { count: 0 };
                        attempts.count++;
                        loginAttempts.set(ip, attempts);
                        return res.status(401).json({ error: 'Invalid email or password.' });
                    }
                    
                    // Reset rate limiting on successful login
                    loginAttempts.delete(ip);
                    
                    const token = jwt.sign(
                        { merchantId: merchant.id, email: merchant.email },
                        process.env.APP_SECRET,
                        { expiresIn: '24h' }
                    );
                    
                    res.cookie('AUTH_COOKIE', token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict',
                        maxAge: 24 * 60 * 60 * 1000 // 24 hours
                    });
                    
                    res.json('Login successful');
                } catch (bcryptError) {
                    res.status(500).json({ error: 'Login failed.' });
                }
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Upload wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
    try {
        const { csv } = req.body;
        
        if (!csv || typeof csv !== 'string') {
            return res.status(400).json({ error: 'CSV data is required.' });
        }
        
        // Parse CSV manually (simple implementation)
        const lines = csv.trim().split('\n');
        const wares = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // Simple CSV parsing (assuming no commas in values)
            const parts = line.split(',');
            
            if (parts.length !== 3) {
                return res.status(400).json({ 
                    error: `Invalid CSV format at line ${i + 1}. Expected 3 columns: name, description, price.` 
                });
            }
            
            const name = parts[0].trim();
            const description = parts[1].trim();
            const priceStr = parts[2].trim();
            
            if (!name || !description || !priceStr) {
                return res.status(400).json({ 
                    error: `Empty fields not allowed at line ${i + 1}.` 
                });
            }
            
            const price = parseFloat(priceStr);
            if (isNaN(price) || price < 0) {
                return res.status(400).json({ 
                    error: `Invalid price at line ${i + 1}. Price must be a non-negative number.` 
                });
            }
            
            wares.push({
                id: uuidv4(),
                name,
                description,
                price
            });
        }
        
        if (wares.length === 0) {
            return res.status(400).json({ error: 'No valid wares found in CSV.' });
        }
        
        // Insert wares into database
        const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
        
        let insertedCount = 0;
        let errors = 0;
        
        wares.forEach((ware) => {
            stmt.run([ware.id, req.merchantId, ware.name, ware.description, ware.price], (err) => {
                if (err) {
                    errors++;
                } else {
                    insertedCount++;
                }
                
                // Check if all operations are complete
                if (insertedCount + errors === wares.length) {
                    stmt.finalize();
                    
                    if (errors > 0) {
                        res.status(500).json({ 
                            error: 'Some wares could not be uploaded.',
                            inserted: insertedCount,
                            failed: errors
                        });
                    } else {
                        res.json({ 
                            message: 'Wares uploaded successfully.',
                            count: insertedCount
                        });
                    }
                }
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Get wares
app.get('/wares', authenticateToken, (req, res) => {
    try {
        const { minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT w.name as ware_name, w.description, w.price, m.email as merchant_email
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
        
        db.all(query, params, (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to retrieve wares.' });
            }
            
            // Generate HTML table
            let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
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
                <td>${sanitizeHtml(row.ware_name)}</td>
                <td>${sanitizeHtml(row.description)}</td>
                <td>${sanitizeHtml(row.price.toString())}</td>
                <td>${sanitizeHtml(row.merchant_email)}</td>
            </tr>`;
            });
            
            html += `
        </tbody>
    </table>
</body>
</html>`;
            
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error.' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});