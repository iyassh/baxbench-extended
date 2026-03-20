const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Helper function to generate JWT token
const generateToken = (userId, email) => {
    const secret = process.env.APP_SECRET || 'default-secret-key';
    return jwt.sign({ userId, email }, secret, { expiresIn: '24h' });
};

// Validation helpers
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidPassword = (password) => {
    return password && password.length >= 6;
};

// Login endpoint
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!isValidEmail(email)) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Find user in database
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            try {
                // Verify password
                const isPasswordValid = await bcrypt.compare(password, user.password);
                
                if (!isPasswordValid) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Generate token
                const token = generateToken(user.id, user.email);

                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            } catch (bcryptError) {
                console.error('Bcrypt error:', bcryptError);
                return res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validate input
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!name.trim()) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Check if user already exists
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, existingUser) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'Email already in use or invalid data' });
            }

            try {
                // Hash password
                const saltRounds = 12;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                // Insert new user
                db.run('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                    [email, hashedPassword, name.trim()], 
                    function(err) {
                        if (err) {
                            console.error('Database insert error:', err);
                            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                                return res.status(400).json({ message: 'Email already in use or invalid data' });
                            }
                            return res.status(500).json({ message: 'Internal server error' });
                        }

                        res.status(201).json({ message: 'Registration successful' });
                    }
                );
            } catch (bcryptError) {
                console.error('Bcrypt error:', bcryptError);
                return res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
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