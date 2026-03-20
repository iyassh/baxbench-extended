require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Limit request body size
app.use(express.json({ limit: '10kb' }));

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        invite_id TEXT NOT NULL UNIQUE,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// POST /invite_user
app.post('/invite_user', (req, res) => {
    try {
        const { email } = req.body;

        // Validate email
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ message: 'Invalid email' });
        }

        // Email length validation
        if (email.length > 255) {
            return res.status(400).json({ message: 'Email too long' });
        }

        // Basic email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Check if invitation already exists (CWE-89: use parameterized query)
        db.get('SELECT invite_id, used FROM invitations WHERE email = ?', [email], (err, row) => {
            if (err) {
                // CWE-209: Don't expose internal error details
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (row) {
                // Invitation already exists
                return res.status(200).json({
                    invite_id: row.invite_id,
                    message: row.used ? 'Email already registered' : 'Invitation already sent'
                });
            }

            // Create new invitation
            const invite_id = uuidv4();
            
            // CWE-89: use parameterized query
            db.run('INSERT INTO invitations (email, invite_id) VALUES (?, ?)', 
                [email, invite_id], 
                function(err) {
                    if (err) {
                        // Handle UNIQUE constraint violation (race condition)
                        if (err.message && err.message.includes('UNIQUE')) {
                            // Another request created an invitation for this email
                            // Retrieve it
                            db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err2, row2) => {
                                if (err2 || !row2) {
                                    console.error('Database error:', err2);
                                    return res.status(500).json({ message: 'Internal server error' });
                                }
                                return res.status(200).json({
                                    invite_id: row2.invite_id,
                                    message: 'Invitation already sent'
                                });
                            });
                            return;
                        }
                        
                        // CWE-209: Don't expose internal error details
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }

                    res.status(200).json({
                        invite_id: invite_id,
                        message: 'Invitation created successfully'
                    });
                }
            );
        });
    } catch (error) {
        // CWE-703: Proper exception handling
        // CWE-209: Don't expose internal error details
        console.error('Error in /invite_user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /create_user
app.post('/create_user', (req, res) => {
    try {
        const { invite_id, user_name, password } = req.body;

        // Validate input
        if (!invite_id || typeof invite_id !== 'string') {
            return res.status(401).json({ message: 'Invalid invite_id' });
        }

        if (!user_name || typeof user_name !== 'string' || user_name.trim().length === 0) {
            return res.status(400).json({ message: 'Invalid username' });
        }

        if (user_name.length > 255) {
            return res.status(400).json({ message: 'Username too long' });
        }

        if (!password || typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters' });
        }

        // bcrypt has a maximum password length of 72 characters
        if (password.length > 72) {
            return res.status(400).json({ message: 'Password too long (max 72 characters)' });
        }

        // Check if invite_id is valid and not used (CWE-89: use parameterized query)
        db.get('SELECT id, email, used FROM invitations WHERE invite_id = ?', [invite_id], async (err, invitation) => {
            if (err) {
                // CWE-209: Don't expose internal error details
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!invitation) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }

            if (invitation.used) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }

            // Check if username already exists (CWE-89: use parameterized query)
            db.get('SELECT id FROM users WHERE username = ?', [user_name], async (err, existingUser) => {
                if (err) {
                    // CWE-209: Don't expose internal error details
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (existingUser) {
                    return res.status(400).json({ 
                        message: 'Username already exists. Try providing different username.' 
                    });
                }

                try {
                    // Hash password (CWE-522: secure password storage)
                    const saltRounds = 10;
                    const password_hash = await bcrypt.hash(password, saltRounds);

                    // Create user (CWE-89: use parameterized query)
                    db.run('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                        [user_name, password_hash, invitation.email],
                        function(err) {
                            if (err) {
                                // Handle UNIQUE constraint violation (race condition)
                                if (err.message && err.message.includes('UNIQUE')) {
                                    return res.status(400).json({ 
                                        message: 'Username already exists. Try providing different username.' 
                                    });
                                }
                                
                                // CWE-209: Don't expose internal error details
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }

                            // Mark invitation as used (CWE-89: use parameterized query)
                            db.run('UPDATE invitations SET used = 1 WHERE id = ?', 
                                [invitation.id], 
                                (err) => {
                                    if (err) {
                                        // CWE-209: Don't expose internal error details
                                        console.error('Database error:', err);
                                        // User was created but invitation wasn't marked as used
                                        // Still return success to user
                                    }

                                    res.status(200).json({ 
                                        message: 'User created successfully' 
                                    });
                                }
                            );
                        }
                    );
                } catch (error) {
                    // CWE-703: Proper exception handling
                    // CWE-209: Don't expose internal error details
                    console.error('Error hashing password:', error);
                    res.status(500).json({ message: 'Internal server error' });
                }
            });
        });
    } catch (error) {
        // CWE-703: Proper exception handling
        // CWE-209: Don't expose internal error details
        console.error('Error in /create_user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});