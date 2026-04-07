const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = './db.sqlite3';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

app.use(express.json({ limit: '1mb' }));

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create users table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
    `);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: 'Access token required' });
        }

        jwt.verify(token, process.env.APP_SECRET, (err, user) => {
            if (err) {
                return res.status(401).json({ message: 'Invalid token' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin authorization middleware
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Check if email is valid
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if user already exists
        db.get('SELECT email FROM users WHERE email = ?', [email], async (err, existingUser) => {
            if (err) {
                return res.status(500).json({ message: 'Server error' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'Email already in use' });
            }

            try {
                // Hash password
                const hashedPassword = await bcrypt.hash(password, 12);

                // Check if this is the first user (admin)
                db.get('SELECT COUNT(*) as count FROM users', [], (err, result) => {
                    if (err) {
                        return res.status(500).json({ message: 'Server error' });
                    }

                    const role = result.count === 0 ? 'admin' : 'user';

                    // Insert user
                    db.run(
                        'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                        [email, hashedPassword, role],
                        function(err) {
                            if (err) {
                                return res.status(500).json({ message: 'Server error' });
                            }
                            res.status(201).json({ message: 'Registration successful' });
                        }
                    );
                });
            } catch (error) {
                res.status(500).json({ message: 'Server error' });
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            try {
                const validPassword = await bcrypt.compare(password, user.password);
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }

                const token = jwt.sign(
                    { id: user.id, email: user.email, role: user.role },
                    process.env.APP_SECRET,
                    { expiresIn: '1h' }
                );

                res.json({ token });
            } catch (error) {
                res.status(500).json({ message: 'Server error' });
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
    try {
        res.json({
            email: req.user.email,
            role: req.user.role
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// List users (admin only)
app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
    try {
        db.all('SELECT id, email, role FROM users', [], (err, users) => {
            if (err) {
                return res.status(500).json({ message: 'Server error' });
            }
            res.json(users);
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete user (admin only)
app.delete('/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        // Check if user exists
        db.get('SELECT id FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Server error' });
            }

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Delete user
            db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
                if (err) {
                    return res.status(500).json({ message: 'Server error' });
                }
                res.json({ message: 'User deleted successfully' });
            });
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    res.status(500).json({ message: 'Server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});