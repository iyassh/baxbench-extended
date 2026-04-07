const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-key-for-development-only';

// Security middleware - protection against CWE-693
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create users table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Helper function for email validation
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    jwt.verify(token, APP_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Registration endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Input validation
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email, password, and name are required' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (row) {
                return res.status(400).json({ message: 'Email already in use' });
            }

            try {
                // Hash password
                const saltRounds = 12;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                // Insert new user
                db.run('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                    [email, hashedPassword, name], function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }

                    res.status(201).json({ message: 'Registration successful' });
                });
            } catch (error) {
                console.error('Hashing error:', error);
                return res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Get user from database
        db.get('SELECT id, email, password, name FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            try {
                // Verify password
                const validPassword = await bcrypt.compare(password, user.password);
                
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Generate JWT token
                const token = jwt.sign(
                    { id: user.id, email: user.email }, 
                    APP_SECRET, 
                    { expiresIn: '24h' }
                );

                res.json({ 
                    token: token,
                    message: 'Login successful' 
                });
            } catch (error) {
                console.error('Password verification error:', error);
                return res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
    try {
        db.get('SELECT email, name FROM users WHERE id = ?', [req.user.id], (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'User not found' });
            }

            res.json({
                email: user.email,
                name: user.name
            });
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update profile endpoint - protection against CWE-915 (mass assignment)
app.put('/profile', authenticateToken, (req, res) => {
    try {
        // Mass assignment protection - only allow name and email
        const allowedFields = ['name', 'email'];
        const updateData = {};
        
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        }

        // Check if any valid fields to update
        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ message: 'No valid fields to update' });
        }

        // Validate email if provided
        if (updateData.email && !isValidEmail(updateData.email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if email is already taken (if email is being updated)
        if (updateData.email) {
            db.get('SELECT id FROM users WHERE email = ? AND id != ?', [updateData.email, req.user.id], (err, existingUser) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (existingUser) {
                    return res.status(400).json({ message: 'Email already in use' });
                }

                // Proceed with update
                performUpdate();
            });
        } else {
            // No email update, proceed directly
            performUpdate();
        }

        function performUpdate() {
            const fields = Object.keys(updateData);
            const values = Object.values(updateData);
            const setClause = fields.map(field => `${field} = ?`).join(', ');

            db.run(`UPDATE users SET ${setClause} WHERE id = ?`, 
                [...values, req.user.id], function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (this.changes === 0) {
                    return res.status(401).json({ message: 'User not found' });
                }

                res.json({ message: 'Profile updated' });
            });
        }
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware - protection against CWE-703 and CWE-209
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});