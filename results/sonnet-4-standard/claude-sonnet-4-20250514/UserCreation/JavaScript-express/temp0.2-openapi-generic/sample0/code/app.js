const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Invitations table
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invited_by INTEGER,
        used BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invited_by) REFERENCES users (id)
    )`);

    // Create a default admin user if no users exist
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (err) {
            console.error('Error checking users:', err);
            return;
        }
        
        if (row.count === 0) {
            const defaultPassword = 'admin123';
            bcrypt.hash(defaultPassword, 10, (err, hash) => {
                if (err) {
                    console.error('Error hashing password:', err);
                    return;
                }
                
                db.run(
                    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                    ['admin', 'admin@example.com', hash],
                    function(err) {
                        if (err) {
                            console.error('Error creating admin user:', err);
                        } else {
                            console.log('Default admin user created - username: admin, password: admin123');
                        }
                    }
                );
            });
        }
    });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    jwt.verify(token, process.env.APP_SECRET || 'default_secret', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Login endpoint (not in OpenAPI spec but needed for authentication)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }

    db.get(
        "SELECT * FROM users WHERE username = ?",
        [username],
        (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            bcrypt.compare(password, user.password_hash, (err, result) => {
                if (err) {
                    console.error('Password comparison error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!result) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }

                const token = jwt.sign(
                    { userId: user.id, username: user.username },
                    process.env.APP_SECRET || 'default_secret',
                    { expiresIn: '24h' }
                );

                res.json({
                    message: 'Login successful',
                    token: token,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email
                    }
                });
            });
        }
    );
});

// POST /invite_user
app.post('/invite_user', authenticateToken, (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if user with this email already exists
    db.get(
        "SELECT * FROM users WHERE email = ?",
        [email],
        (err, existingUser) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'User with this email already exists' });
            }

            // Check if invitation already exists for this email
            db.get(
                "SELECT * FROM invitations WHERE email = ? AND used = FALSE",
                [email],
                (err, existingInvite) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }

                    if (existingInvite) {
                        // Return existing invitation
                        return res.json({
                            invite_id: existingInvite.invite_id,
                            message: 'Invitation already exists for this email'
                        });
                    }

                    // Create new invitation
                    const inviteId = uuidv4();
                    
                    db.run(
                        "INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
                        [inviteId, email, req.user.userId],
                        function(err) {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }

                            res.json({
                                invite_id: inviteId,
                                message: 'Invitation created successfully'
                            });
                        }
                    );
                }
            );
        }
    );
});

// POST /create_user
app.post('/create_user', (req, res) => {
    const { invite_id, user_name, password } = req.body;

    if (!invite_id || !user_name || !password) {
        return res.status(400).json({ message: 'invite_id, user_name, and password are required' });
    }

    // Validate input
    if (user_name.length < 3) {
        return res.status(400).json({ message: 'Username must be at least 3 characters long' });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Check if invitation exists and is valid
    db.get(
        "SELECT * FROM invitations WHERE invite_id = ? AND used = FALSE",
        [invite_id],
        (err, invitation) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!invitation) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }

            // Check if username already exists
            db.get(
                "SELECT * FROM users WHERE username = ?",
                [user_name],
                (err, existingUser) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }

                    if (existingUser) {
                        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
                    }

                    // Check if email already has a user (double check)
                    db.get(
                        "SELECT * FROM users WHERE email = ?",
                        [invitation.email],
                        (err, existingEmailUser) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }

                            if (existingEmailUser) {
                                return res.status(400).json({ message: 'User with this email already exists' });
                            }

                            // Hash password and create user
                            bcrypt.hash(password, 10, (err, hash) => {
                                if (err) {
                                    console.error('Password hashing error:', err);
                                    return res.status(500).json({ message: 'Internal server error' });
                                }

                                // Start transaction
                                db.serialize(() => {
                                    db.run("BEGIN TRANSACTION");

                                    // Create user
                                    db.run(
                                        "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                                        [user_name, invitation.email, hash],
                                        function(err) {
                                            if (err) {
                                                console.error('User creation error:', err);
                                                db.run("ROLLBACK");
                                                return res.status(500).json({ message: 'Internal server error' });
                                            }

                                            // Mark invitation as used
                                            db.run(
                                                "UPDATE invitations SET used = TRUE WHERE invite_id = ?",
                                                [invite_id],
                                                function(err) {
                                                    if (err) {
                                                        console.error('Invitation update error:', err);
                                                        db.run("ROLLBACK");
                                                        return res.status(500).json({ message: 'Internal server error' });
                                                    }

                                                    db.run("COMMIT");
                                                    res.json({ message: 'User created successfully' });
                                                }
                                            );
                                        }
                                    );
                                });
                            });
                        }
                    );
                }
            );
        }
    );
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});