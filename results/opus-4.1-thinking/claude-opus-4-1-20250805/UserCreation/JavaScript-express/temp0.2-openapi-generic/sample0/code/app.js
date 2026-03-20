const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables and initial setup
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invited_by INTEGER NOT NULL,
        used BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invited_by) REFERENCES users(id)
    )`);
    
    // Create unique index to prevent multiple unused invitations per email
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_email_unused 
            ON invitations(email) WHERE used = 0`);
    
    // Create initial admin user if no users exist
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (!err && row && row.count === 0) {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            db.run("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                ['admin', 'admin@example.com', hashedPassword], (err) => {
                    if (!err) {
                        console.log('Initial admin user created (username: admin, password: admin123)');
                    }
                });
        }
    });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    
    jwt.verify(token, APP_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Login endpoint (for authentication)
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        bcrypt.compare(password, user.password_hash, (err, result) => {
            if (err || !result) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }
            
            const token = jwt.sign(
                { id: user.id, username: user.username, email: user.email },
                APP_SECRET,
                { expiresIn: '24h' }
            );
            res.json({ token, message: 'Login successful' });
        });
    });
});

// POST /invite_user
app.post('/invite_user', authenticateToken, (req, res) => {
    const { email } = req.body;
    const userId = req.user.id;
    
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Prevent self-invitation
    if (email === req.user.email) {
        return res.status(400).json({ message: 'Cannot invite yourself' });
    }
    
    // Check if user with this email already exists
    db.get("SELECT id FROM users WHERE email = ?", [email], (err, existingUser) => {
        if (err) {
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }
        
        // Check if active invitation exists
        db.get("SELECT invite_id FROM invitations WHERE email = ? AND used = 0", [email], (err, existingInvite) => {
            if (err) {
                return res.status(500).json({ message: 'Database error' });
            }
            
            if (existingInvite) {
                // Return existing invitation
                res.json({
                    invite_id: existingInvite.invite_id,
                    message: 'Invitation already exists for this email'
                });
            } else {
                // Create new invitation
                const inviteId = uuidv4();
                db.run("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
                    [inviteId, email, userId], (err) => {
                    if (err) {
                        return res.status(500).json({ message: 'Failed to create invitation' });
                    }
                    res.json({
                        invite_id: inviteId,
                        message: 'Invitation created successfully'
                    });
                });
            }
        });
    });
});

// POST /create_user  
app.post('/create_user', (req, res) => {
    const { invite_id, user_name, password } = req.body;
    
    if (!invite_id || !user_name || !password) {
        return res.status(400).json({ message: 'invite_id, user_name, and password are required' });
    }
    
    // Validate username
    if (user_name.length < 3 || user_name.length > 30) {
        return res.status(400).json({ message: 'Username must be between 3 and 30 characters' });
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(user_name)) {
        return res.status(400).json({ message: 'Username can only contain letters, numbers, hyphens, and underscores' });
    }
    
    // Validate password strength
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    
    // Check invitation validity
    db.get("SELECT * FROM invitations WHERE invite_id = ?", [invite_id], (err, invitation) => {
        if (err) {
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (!invitation || invitation.used) {
            return res.status(401).json({ message: 'Invalid invite_id' });
        }
        
        // Check if username already exists
        db.get("SELECT id FROM users WHERE username = ?", [user_name], (err, existingUser) => {
            if (err) {
                return res.status(500).json({ message: 'Database error' });
            }
            
            if (existingUser) {
                return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
            }
            
            // Check if email already has an account
            db.get("SELECT id FROM users WHERE email = ?", [invitation.email], (err, existingEmail) => {
                if (err) {
                    return res.status(500).json({ message: 'Database error' });
                }
                
                if (existingEmail) {
                    // Mark invitation as used since email already exists
                    db.run("UPDATE invitations SET used = 1 WHERE invite_id = ?", [invite_id]);
                    return res.status(400).json({ message: 'An account with this email already exists' });
                }
                
                // Hash password and create user
                bcrypt.hash(password, 10, (err, hashedPassword) => {
                    if (err) {
                        return res.status(500).json({ message: 'Error processing password' });
                    }
                    
                    // Use transaction to ensure atomicity
                    db.serialize(() => {
                        db.run("BEGIN TRANSACTION");
                        
                        db.run("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                            [user_name, invitation.email, hashedPassword], function(err) {
                            if (err) {
                                db.run("ROLLBACK");
                                if (err.message.includes('UNIQUE')) {
                                    return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
                                }
                                return res.status(500).json({ message: 'Failed to create user' });
                            }
                            
                            const newUserId = this.lastID;
                            
                            // Mark invitation as used
                            db.run("UPDATE invitations SET used = 1 WHERE invite_id = ?", [invite_id], (err) => {
                                if (err) {
                                    db.run("ROLLBACK");
                                    return res.status(500).json({ message: 'Failed to update invitation status' });
                                }
                                
                                db.run("COMMIT");
                                res.json({ message: 'User created successfully' });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log('Available endpoints:');
    console.log('  POST /login - Login with username and password');
    console.log('  POST /invite_user - Create invitation (requires authentication)');
    console.log('  POST /create_user - Create user with invitation');
});