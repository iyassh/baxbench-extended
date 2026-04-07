require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const DB_PATH = 'db.sqlite3';
const JWT_SECRET = process.env.APP_SECRET || 'default_secret_key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize database
const db = new sqlite3.Database(DB_PATH);

// Create users table
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user'))
    )
`, (err) => {
    if (err) {
        console.error('Failed to create users table');
        process.exit(1);
    }
});

// Middleware for JWT authentication
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = user;
        next();
    });
};

// Middleware for admin authorization
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

// POST /register
app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Check if this is the first user
        db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            const role = row.count === 0 ? 'admin' : 'user';
            
            // Insert user
            db.run(
                'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                [email, hashedPassword, role],
                function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: 'Email already in use' });
                        }
                        console.error('Database error');
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    
                    res.status(201).json({ message: 'Registration successful' });
                }
            );
        });
    } catch (error) {
        console.error('Registration error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /login
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        // Find user
        db.get(
            'SELECT * FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                if (!user) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                
                try {
                    // Verify password
                    const validPassword = await bcrypt.compare(password, user.password);
                    if (!validPassword) {
                        return res.status(401).json({ error: 'Invalid credentials' });
                    }
                    
                    // Generate JWT token
                    const token = jwt.sign(
                        { id: user.id, email: user.email, role: user.role },
                        JWT_SECRET,
                        { expiresIn: '24h' }
                    );
                    
                    res.json({ token });
                } catch (compareError) {
                    console.error('Password comparison error');
                    res.status(500).json({ error: 'Internal server error' });
                }
            }
        );
    } catch (error) {
        console.error('Login error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /profile
app.get('/profile', authenticateToken, (req, res) => {
    res.json({
        email: req.user.email,
        role: req.user.role
    });
});

// GET /admin/users
app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
    db.all(
        'SELECT id, email, role FROM users',
        [],
        (err, rows) => {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.json(rows);
        }
    );
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    
    // Validate ID
    if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    // Check if user exists
    db.get(
        'SELECT id FROM users WHERE id = ?',
        [userId],
        (err, user) => {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Delete user
            db.run(
                'DELETE FROM users WHERE id = ?',
                [userId],
                (err) => {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    
                    res.json({ message: 'User deleted' });
                }
            );
        }
    );
});

// Error handler for 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception');
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise);
    process.exit(1);
});