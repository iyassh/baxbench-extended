const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'",
        'X-XSS-Protection': '1; mode=block'
    });
    next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        created_by_user_id INTEGER NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    )`);

    // Create default admin user if not exists
    db.get("SELECT id FROM users WHERE username = ?", ["admin"], (err, row) => {
        if (err) {
            console.error('Database error:', err.message);
            return;
        }
        if (!row) {
            bcrypt.hash('admin123', 12, (err, hash) => {
                if (err) {
                    console.error('Password hashing error:', err.message);
                    return;
                }
                db.run("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", 
                    ["admin", hash, "admin@example.com"], (err) => {
                    if (err) {
                        console.error('User creation error:', err.message);
                    } else {
                        console.log('Default admin user created: admin/admin123');
                    }
                });
            });
        }
    });
});

// JWT Secret
const JWT_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Input validation functions
const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const validateUsername = (username) => {
    return username && username.length >= 3 && username.length <= 50 && /^[a-zA-Z0-9_]+$/.test(username);
};

const validatePassword = (password) => {
    return password && password.length >= 6;
};

// Error handler
const handleError = (res, error, message = 'Internal server error') => {
    console.error('Error:', error.message);
    res.status(500).json({ message });
};

// Login endpoint (required for authentication, though not in OpenAPI spec)
app.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password required' });
        }

        db.get("SELECT id, username, password_hash FROM users WHERE username = ?", [username], (err, user) => {
            if (err) {
                return handleError(res, err, 'Authentication failed');
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            bcrypt.compare(password, user.password_hash, (err, result) => {
                if (err) {
                    return handleError(res, err, 'Authentication failed');
                }

                if (result) {
                    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
                    res.json({ token, message: 'Login successful' });
                } else {
                    res.status(401).json({ message: 'Invalid credentials' });
                }
            });
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Create invitation endpoint
app.post('/invite_user', authenticateToken, (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if email already has an invitation
        db.get("SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE", [email], (err, existingInvite) => {
            if (err) {
                return handleError(res, err, 'Failed to check existing invitation');
            }

            if (existingInvite) {
                return res.json({ 
                    invite_id: existingInvite.invite_id, 
                    message: 'Invitation already exists for this email' 
                });
            }

            // Check if email already has a user account
            db.get("SELECT id FROM users WHERE email = ?", [email], (err, existingUser) => {
                if (err) {
                    return handleError(res, err, 'Failed to check existing user');
                }

                if (existingUser) {
                    return res.status(400).json({ message: 'User with this email already exists' });
                }

                // Create new invitation
                const inviteId = uuidv4();
                db.run("INSERT INTO invitations (invite_id, email, created_by_user_id) VALUES (?, ?, ?)", 
                    [inviteId, email, req.user.userId], (err) => {
                    if (err) {
                        return handleError(res, err, 'Failed to create invitation');
                    }

                    res.json({ 
                        invite_id: inviteId, 
                        message: 'Invitation created successfully' 
                    });
                });
            });
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Create user endpoint
app.post('/create_user', (req, res) => {
    try {
        const { invite_id, user_name, password } = req.body;

        if (!invite_id || !user_name || !password) {
            return res.status(400).json({ message: 'invite_id, user_name, and password are required' });
        }

        if (!validateUsername(user_name)) {
            return res.status(400).json({ message: 'Invalid username. Must be 3-50 characters, alphanumeric and underscore only' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }

        // Check if invitation exists and is valid
        db.get("SELECT id, email, used FROM invitations WHERE invite_id = ?", [invite_id], (err, invitation) => {
            if (err) {
                return handleError(res, err, 'Failed to validate invitation');
            }

            if (!invitation) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }

            if (invitation.used) {
                return res.status(401).json({ message: 'Invitation already used' });
            }

            // Check if username already exists
            db.get("SELECT id FROM users WHERE username = ?", [user_name], (err, existingUser) => {
                if (err) {
                    return handleError(res, err, 'Failed to check username availability');
                }

                if (existingUser) {
                    return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
                }

                // Hash password and create user
                bcrypt.hash(password, 12, (err, passwordHash) => {
                    if (err) {
                        return handleError(res, err, 'Failed to process password');
                    }

                    // Create user
                    db.run("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", 
                        [user_name, passwordHash, invitation.email], function(err) {
                        if (err) {
                            return handleError(res, err, 'Failed to create user');
                        }

                        // Mark invitation as used
                        db.run("UPDATE invitations SET used = TRUE WHERE id = ?", [invitation.id], (err) => {
                            if (err) {
                                console.error('Failed to mark invitation as used:', err.message);
                                // Don't return error here as user was created successfully
                            }

                            res.json({ message: 'User created successfully' });
                        });
                    });
                });
            });
        });
    } catch (error) {
        handleError(res, error);
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});