const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    // Create invitations table
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT FALSE
    )`, (err) => {
        if (err) {
            console.error('Error creating invitations table:', err.message);
        }
    });

    // Create users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        invite_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invite_id) REFERENCES invitations (invite_id)
    )`, (err) => {
        if (err) {
            console.error('Error creating users table:', err.message);
        }
    });
}

// POST /invite_user
app.post('/invite_user', (req, res) => {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({
            message: 'Valid email is required'
        });
    }

    // Check if email already has an invitation
    db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({
                message: 'Internal server error'
            });
        }

        if (row) {
            // Email already invited, return existing invite_id
            return res.status(200).json({
                invite_id: row.invite_id,
                message: 'Invitation already exists for this email'
            });
        }

        // Create new invitation
        const inviteId = uuidv4();
        
        db.run('INSERT INTO invitations (invite_id, email) VALUES (?, ?)', 
            [inviteId, email], 
            function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({
                        message: 'Internal server error'
                    });
                }

                res.status(200).json({
                    invite_id: inviteId,
                    message: 'Invitation created successfully'
                });
            }
        );
    });
});

// POST /create_user
app.post('/create_user', async (req, res) => {
    const { invite_id, user_name, password } = req.body;

    if (!invite_id || !user_name || !password) {
        return res.status(400).json({
            message: 'invite_id, user_name, and password are required'
        });
    }

    try {
        // Check if invite_id is valid and not used
        db.get('SELECT * FROM invitations WHERE invite_id = ? AND used = FALSE', 
            [invite_id], 
            async (err, invitation) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({
                        message: 'Internal server error'
                    });
                }

                if (!invitation) {
                    return res.status(401).json({
                        message: 'Invalid invite_id'
                    });
                }

                // Check if username already exists
                db.get('SELECT id FROM users WHERE user_name = ?', [user_name], async (err, existingUser) => {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({
                            message: 'Internal server error'
                        });
                    }

                    if (existingUser) {
                        return res.status(400).json({
                            message: 'Username already exists. Try providing different username.'
                        });
                    }

                    try {
                        // Hash password
                        const saltRounds = 10;
                        const passwordHash = await bcrypt.hash(password, saltRounds);

                        // Create user
                        db.run('INSERT INTO users (user_name, email, password_hash, invite_id) VALUES (?, ?, ?, ?)',
                            [user_name, invitation.email, passwordHash, invite_id],
                            function(err) {
                                if (err) {
                                    console.error('Database error:', err.message);
                                    return res.status(500).json({
                                        message: 'Internal server error'
                                    });
                                }

                                // Mark invitation as used
                                db.run('UPDATE invitations SET used = TRUE WHERE invite_id = ?', 
                                    [invite_id], 
                                    (err) => {
                                        if (err) {
                                            console.error('Database error:', err.message);
                                        }
                                    }
                                );

                                res.status(200).json({
                                    message: 'User created successfully'
                                });
                            }
                        );
                    } catch (hashError) {
                        console.error('Password hashing error:', hashError);
                        return res.status(500).json({
                            message: 'Internal server error'
                        });
                    }
                });
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// Helper function to validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        message: 'Internal server error'
    });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        message: 'Endpoint not found'
    });
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
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});