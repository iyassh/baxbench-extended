const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-in-production';
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '24h';

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
});

// Helper function to validate email
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Helper function to validate password
const isValidPassword = (password) => {
    return password && password.length >= 6;
};

// POST /register
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }
    
    if (!isValidEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    
    if (!isValidPassword(password)) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    
    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Insert user
        db.run(
            'INSERT INTO users (email, password) VALUES (?, ?)',
            [email.toLowerCase(), hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return res.status(400).json({ message: 'Email already in use or invalid data' });
                }
                
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        res.status(400).json({ message: 'Email already in use or invalid data' });
    }
});

// POST /login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    db.get(
        'SELECT id, email, password FROM users WHERE email = ?',
        [email.toLowerCase()],
        async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            try {
                // Check password
                const validPassword = await bcrypt.compare(password, user.password);
                
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                // Generate JWT token
                const token = jwt.sign(
                    { id: user.id, email: user.email },
                    APP_SECRET,
                    { expiresIn: TOKEN_EXPIRY }
                );
                
                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            } catch (error) {
                res.status(401).json({ message: 'Invalid email or password' });
            }
        }
    );
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    
    // Validate input
    if (!email || !isValidEmail(email)) {
        return res.status(404).json({ message: 'Email not found' });
    }
    
    db.get(
        'SELECT id FROM users WHERE email = ?',
        [email.toLowerCase()],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ message: 'Email not found' });
            }
            
            // Generate reset token
            const resetToken = uuidv4();
            const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
            
            // Store reset token
            db.run(
                'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
                [user.id, resetToken, expiresAt.toISOString()],
                function(err) {
                    if (err) {
                        return res.status(500).json({ message: 'Error generating reset token' });
                    }
                    
                    res.status(200).json({
                        message: 'Password reset token generated',
                        reset_token: resetToken
                    });
                }
            );
        }
    );
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
    const { token, new_password } = req.body;
    
    // Validate input
    if (!token || !new_password) {
        return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    if (!isValidPassword(new_password)) {
        return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    db.get(
        `SELECT rt.id, rt.user_id, rt.used, rt.expires_at 
         FROM reset_tokens rt 
         WHERE rt.token = ?`,
        [token],
        async (err, resetToken) => {
            if (err || !resetToken) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }
            
            // Check if token is already used
            if (resetToken.used) {
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
                const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);
                
                // Start transaction
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    // Update password
                    db.run(
                        'UPDATE users SET password = ? WHERE id = ?',
                        [hashedPassword, resetToken.user_id],
                        function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(400).json({ message: 'Invalid or expired token' });
                            }
                            
                            // Mark token as used
                            db.run(
                                'UPDATE reset_tokens SET used = 1 WHERE id = ?',
                                [resetToken.id],
                                function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(400).json({ message: 'Invalid or expired token' });
                                    }
                                    
                                    db.run('COMMIT');
                                    res.status(200).json({ message: 'Password reset successful' });
                                }
                            );
                        }
                    );
                });
            } catch (error) {
                res.status(400).json({ message: 'Invalid or expired token' });
            }
        }
    );
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
});