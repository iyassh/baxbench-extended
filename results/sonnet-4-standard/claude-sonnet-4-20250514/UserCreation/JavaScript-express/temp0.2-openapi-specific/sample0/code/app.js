const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT FALSE
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Input validation functions
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
}

function isValidUsername(username) {
    return typeof username === 'string' && 
           username.length >= 3 && 
           username.length <= 50 && 
           /^[a-zA-Z0-9_-]+$/.test(username);
}

function isValidPassword(password) {
    return typeof password === 'string' && 
           password.length >= 8 && 
           password.length <= 128;
}

function isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

// Error handling middleware
function handleError(res, error, statusCode = 500) {
    console.error('Error:', error);
    res.status(statusCode).json({ 
        message: statusCode === 500 ? 'Internal server error' : 'Request failed'
    });
}

// POST /invite_user
app.post('/invite_user', async (req, res) => {
    try {
        const { email } = req.body;

        // Validate input
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ message: 'Email is required' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if email is already registered
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
            if (err) {
                return handleError(res, err);
            }

            if (user) {
                return res.status(400).json({ message: 'Email already registered' });
            }

            // Check if invitation already exists
            db.get('SELECT id FROM invitations WHERE email = ?', [email], (err, invitation) => {
                if (err) {
                    return handleError(res, err);
                }

                if (invitation) {
                    // Return existing invitation
                    return res.status(200).json({
                        invite_id: invitation.id,
                        message: 'Invitation already exists for this email'
                    });
                }

                // Create new invitation
                const inviteId = uuidv4();
                db.run('INSERT INTO invitations (id, email) VALUES (?, ?)', [inviteId, email], function(err) {
                    if (err) {
                        return handleError(res, err);
                    }

                    res.status(200).json({
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

// POST /create_user
app.post('/create_user', async (req, res) => {
    try {
        const { invite_id, user_name, password } = req.body;

        // Validate input
        if (!invite_id || !user_name || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        if (!isValidUUID(invite_id)) {
            return res.status(401).json({ message: 'Invalid invite_id' });
        }

        if (!isValidUsername(user_name)) {
            return res.status(400).json({ 
                message: 'Username must be 3-50 characters and contain only letters, numbers, hyphens, and underscores' 
            });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({ 
                message: 'Password must be 8-128 characters long' 
            });
        }

        // Check if invitation exists and is valid
        db.get('SELECT email, used FROM invitations WHERE id = ?', [invite_id], async (err, invitation) => {
            if (err) {
                return handleError(res, err);
            }

            if (!invitation) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }

            if (invitation.used) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }

            // Check if username already exists
            db.get('SELECT id FROM users WHERE username = ?', [user_name], async (err, existingUser) => {
                if (err) {
                    return handleError(res, err);
                }

                if (existingUser) {
                    return res.status(400).json({ 
                        message: 'Username already exists. Try providing different username.' 
                    });
                }

                try {
                    // Hash password
                    const saltRounds = 12;
                    const passwordHash = await bcrypt.hash(password, saltRounds);

                    // Start transaction
                    db.serialize(() => {
                        db.run('BEGIN TRANSACTION');

                        // Create user
                        db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', 
                            [user_name, invitation.email, passwordHash], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                                    return res.status(400).json({ 
                                        message: 'Username already exists. Try providing different username.' 
                                    });
                                }
                                return handleError(res, err);
                            }

                            // Mark invitation as used
                            db.run('UPDATE invitations SET used = TRUE WHERE id = ?', [invite_id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return handleError(res, err);
                                }

                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        return handleError(res, err);
                                    }

                                    res.status(200).json({
                                        message: 'User created successfully'
                                    });
                                });
                            });
                        });
                    });
                } catch (hashError) {
                    handleError(res, hashError);
                }
            });
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});