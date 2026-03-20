const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// JWT secret
const JWT_SECRET = process.env.APP_SECRET || 'fallback-secret';

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        invite_id TEXT UNIQUE NOT NULL,
        created_by_user_id INTEGER,
        used BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    )`, () => {
        // Create initial admin user if no users exist
        db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
            if (!err && row.count === 0) {
                try {
                    const adminPassword = await bcrypt.hash('admin123', 12);
                    db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                           ['admin', 'admin@example.com', adminPassword]);
                    console.log('Initial admin user created: admin / admin123');
                } catch (error) {
                    console.error('Failed to create initial admin user:', error);
                }
            }
        });
    });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Input validation helpers
const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Login endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        try {
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }
            
            const token = jwt.sign(
                { id: user.id, username: user.username }, 
                JWT_SECRET, 
                { expiresIn: '24h' }
            );
            
            res.json({ token, message: 'Login successful' });
        } catch (error) {
            console.error('Password comparison error:', error);
            res.status(500).json({ message: 'Authentication error' });
        }
    });
});

// Invite user endpoint
app.post('/invite_user', authenticateToken, (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }
    
    if (!validateEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Check if invitation already exists for this email
    db.get('SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE', [email], (err, existingInvite) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (existingInvite) {
            return res.json({ 
                invite_id: existingInvite.invite_id,
                message: 'Invitation already exists for this email'
            });
        }
        
        // Check if user with this email already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, existingUser) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Database error' });
            }
            
            if (existingUser) {
                return res.status(400).json({ message: 'User with this email already exists' });
            }
            
            // Create new invitation
            const inviteId = uuidv4();
            
            db.run('INSERT INTO invitations (email, invite_id, created_by_user_id) VALUES (?, ?, ?)', 
                   [email, inviteId, req.user.id], 
                   function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Failed to create invitation' });
                }
                
                res.json({
                    invite_id: inviteId,
                    message: 'Invitation created successfully'
                });
            });
        });
    });
});

// Create user endpoint
app.post('/create_user', (req, res) => {
    const { invite_id, user_name, password } = req.body;
    
    if (!invite_id || !user_name || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Validate invitation
    db.get('SELECT * FROM invitations WHERE invite_id = ? AND used = FALSE', [invite_id], (err, invitation) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (!invitation) {
            return res.status(401).json({ message: 'Invalid invite_id' });
        }
        
        // Check if username already exists
        db.get('SELECT id FROM users WHERE username = ?', [user_name], async (err, existingUser) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Database error' });
            }
            
            if (existingUser) {
                return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
            }
            
            try {
                // Hash password
                const saltRounds = 12;
                const password_hash = await bcrypt.hash(password, saltRounds);
                
                // Create user
                db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                       [user_name, invitation.email, password_hash],
                       function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Failed to create user' });
                    }
                    
                    // Mark invitation as used
                    db.run('UPDATE invitations SET used = TRUE WHERE invite_id = ?', [invite_id], (err) => {
                        if (err) {
                            console.error('Failed to mark invitation as used:', err);
                        }
                    });
                    
                    res.json({ message: 'User created successfully' });
                });
            } catch (error) {
                console.error('Password hashing error:', error);
                res.status(500).json({ message: 'Failed to create user' });
            }
        });
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});