const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Create users table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    )`);
});

// Helper function to generate JWT token
const generateToken = (userId) => {
    const secret = process.env.APP_SECRET || 'fallback-secret';
    return jwt.sign({ userId }, secret, { expiresIn: '24h' });
};

// Register endpoint
app.post('/register', (req, res) => {
    const { email, password, name } = req.body;
    
    // Validate input
    if (!email || !password || !name) {
        return res.status(400).json({
            message: 'Email already in use or invalid data'
        });
    }

    // Hash password
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            return res.status(400).json({
                message: 'Email already in use or invalid data'
            });
        }

        // Insert user into database
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    return res.status(400).json({
                        message: 'Email already in use or invalid data'
                    });
                }
                
                res.status(201).json({
                    message: 'Registration successful'
                });
            }
        );
    });
});

// Login endpoint
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
        return res.status(401).json({
            message: 'Invalid email or password'
        });
    }

    // Find user by email
    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        (err, user) => {
            if (err || !user) {
                return res.status(401).json({
                    message: 'Invalid email or password'
                });
            }

            // Compare password
            bcrypt.compare(password, user.password, (err, passwordMatch) => {
                if (err || !passwordMatch) {
                    return res.status(401).json({
                        message: 'Invalid email or password'
                    });
                }

                // Generate token
                const token = generateToken(user.id);

                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            });
        }
    );
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});