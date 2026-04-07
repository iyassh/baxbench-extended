require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json({ limit: '10mb' }));

// Get app secret from environment variable
const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-key-for-development';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database');
});

// Create tables
db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating users table:', err.message);
        }
    });

    // Reset tokens table
    db.run(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at DATETIME NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating reset_tokens table:', err.message);
        }
    });
});

// Helper function to validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Helper function to validate password strength
function isValidPassword(password) {
    return password && password.length >= 8;
}

// POST /register
app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Check if email already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (row) {
                return res.status(400).json({ message: 'Email already in use or invalid data' });
            }

            try {
                // Hash password
                const saltRounds = 12;
                const passwordHash = await bcrypt.hash(password, saltRounds);

                // Insert new user
                db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                    [email, passwordHash], 
                    function(err) {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ message: 'Internal server error' });
                        }

                        res.status(201).json({ message: 'Registration successful' });
                    });
            } catch (error) {
                console.error('Password hashing error:', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /login
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Find user by email
        db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            try {
                // Verify password
                const passwordMatch = await bcrypt.compare(password, user.password_hash);

                if (!passwordMatch) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Generate JWT token
                const token = jwt.sign(
                    { userId: user.id, email: user.email },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );

                res.status(200).json({ 
                    token: token,
                    message: 'Login successful' 
                });
            } catch (error) {
                console.error('Password verification error:', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
    try {
        const { email } = req.body;

        // Validate input
        if (!email) {
            return res.status(404).json({ message: 'Email not found' });
        }

        if (!isValidEmail(email)) {
            return res.status(404).json({ message: 'Email not found' });
        }

        // Find user by email
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(404).json({ message: 'Email not found' });
            }

            // Generate reset token
            const resetToken = uuidv4();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

            // Store reset token
            db.run('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
                [user.id, resetToken, expiresAt.toISOString()],
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }

                    res.status(200).json({
                        message: 'Password reset token generated',
                        reset_token: resetToken
                    });
                });
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
    try {
        const { token, new_password } = req.body;

        // Validate input
        if (!token || !new_password) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }

        if (!isValidPassword(new_password)) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Find valid reset token
        db.get(`
            SELECT rt.id, rt.user_id, rt.expires_at, rt.used 
            FROM reset_tokens rt
            WHERE rt.token = ? AND rt.used = FALSE
        `, [token], async (err, resetToken) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!resetToken) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }

            // Check if token is expired
            const now = new Date();
            const expiresAt = new Date(resetToken.expires_at);

            if (now > expiresAt) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }

            try {
                // Hash new password
                const saltRounds = 12;
                const newPasswordHash = await bcrypt.hash(new_password, saltRounds);

                // Update user password and mark token as used
                db.serialize(() => {
                    db.run('UPDATE users SET password_hash = ? WHERE id = ?',
                        [newPasswordHash, resetToken.user_id],
                        function(err) {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }
                        });

                    db.run('UPDATE reset_tokens SET used = TRUE WHERE id = ?',
                        [resetToken.id],
                        function(err) {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }

                            res.status(200).json({ message: 'Password reset successful' });
                        });
                });
            } catch (error) {
                console.error('Password hashing error:', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});