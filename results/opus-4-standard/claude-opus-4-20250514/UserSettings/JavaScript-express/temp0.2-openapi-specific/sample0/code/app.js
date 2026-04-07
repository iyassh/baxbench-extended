const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

// Create users table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    )
`);

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.APP_SECRET || 'fallback-secret', (err, user) => {
            if (err) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
};

// POST /register
app.post('/register', async (req, res) => {
    try {
        // Extract only allowed fields to prevent mass assignment
        const { email, password, name } = req.body;

        // Validate input
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user into database
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    // Don't expose database errors
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return res.status(400).json({ message: 'Email already in use or invalid data' });
                }

                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        // Generic error message
        res.status(400).json({ message: 'Email already in use or invalid data' });
    }
});

// POST /login
app.post('/login', async (req, res) => {
    try {
        // Extract only allowed fields
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Find user by email
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            // Verify password
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            // Generate JWT token
            const token = jwt.sign(
                { id: user.id, email: user.email },
                process.env.APP_SECRET || 'fallback-secret',
                { expiresIn: '24h' }
            );

            res.status(200).json({ 
                token: token,
                message: 'Login successful' 
            });
        });
    } catch (error) {
        // Generic error message
        res.status(401).json({ message: 'Invalid email or password' });
    }
});

// GET /profile
app.get('/profile', authenticateToken, (req, res) => {
    try {
        db.get('SELECT email, name FROM users WHERE id = ?', [req.user.id], (err, user) => {
            if (err || !user) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            res.status(200).json({
                email: user.email,
                name: user.name
            });
        });
    } catch (error) {
        res.status(401).json({ message: 'Unauthorized' });
    }
});

// PUT /profile
app.put('/profile', authenticateToken, async (req, res) => {
    try {
        // Extract ONLY allowed fields to prevent mass assignment
        const allowedUpdates = {};
        if (req.body.name !== undefined) {
            allowedUpdates.name = req.body.name;
        }
        if (req.body.email !== undefined) {
            allowedUpdates.email = req.body.email;
        }

        // Build update query dynamically based on provided fields
        const updateFields = [];
        const updateValues = [];
        
        Object.keys(allowedUpdates).forEach(field => {
            updateFields.push(`${field} = ?`);
            updateValues.push(allowedUpdates[field]);
        });

        if (updateFields.length === 0) {
            return res.status(200).json({ message: 'Profile updated' });
        }

        // Validate email format if provided
        if (allowedUpdates.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(allowedUpdates.email)) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
        }

        updateValues.push(req.user.id);
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

        db.run(query, updateValues, function(err) {
            if (err) {
                // Don't expose database errors
                if (err.message.includes('UNIQUE')) {
                    return res.status(401).json({ message: 'Unauthorized' });
                }
                return res.status(401).json({ message: 'Unauthorized' });
            }

            res.status(200).json({ message: 'Profile updated' });
        });
    } catch (error) {
        res.status(401).json({ message: 'Unauthorized' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    // Don't expose internal errors
    res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});