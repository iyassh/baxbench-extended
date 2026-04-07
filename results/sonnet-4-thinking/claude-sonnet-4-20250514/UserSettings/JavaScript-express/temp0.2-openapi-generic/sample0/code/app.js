require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Check for required environment variables
if (!process.env.APP_SECRET) {
    console.error('APP_SECRET environment variable is required');
    process.exit(1);
}

const APP_SECRET = process.env.APP_SECRET;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database schema
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Database helper functions
const dbGet = (query, params) => {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const dbRun = (query, params) => {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, APP_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Validation helpers
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Routes

// POST /register
app.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validation
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email, password, and name are required' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }

        if (name.trim().length === 0) {
            return res.status(400).json({ message: 'Name cannot be empty' });
        }

        // Check if email already exists
        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ message: 'Email already in use' });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert new user
        await dbRun('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', [email, hashedPassword, name.trim()]);

        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /login
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Find user by email
        const user = await dbGet('SELECT id, email, password FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            APP_SECRET,
            { expiresIn: '24h' }
        );

        res.status(200).json({
            token: token,
            message: 'Login successful'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /profile
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = await dbGet('SELECT email, name FROM users WHERE id = ?', [req.userId]);
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        res.status(200).json({
            email: user.email,
            name: user.name
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /profile
app.put('/profile', authenticateToken, async (req, res) => {
    try {
        // Mass assignment protection - only allow name and email
        const allowedFields = ['name', 'email'];
        const updates = {};
        
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        // Check if there are any valid updates
        const updateFields = Object.keys(updates);
        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'No valid fields to update' });
        }

        // Validate email if provided
        if (updates.email && !isValidEmail(updates.email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Validate name if provided
        if (updates.name && updates.name.trim().length === 0) {
            return res.status(400).json({ message: 'Name cannot be empty' });
        }

        // Trim name
        if (updates.name) {
            updates.name = updates.name.trim();
        }

        // Check if email is already taken by another user
        if (updates.email) {
            const existingUser = await dbGet('SELECT id FROM users WHERE email = ? AND id != ?', [updates.email, req.userId]);
            if (existingUser) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }

        // Build dynamic SQL query
        const setClause = updateFields.map(field => `${field} = ?`).join(', ');
        const values = updateFields.map(field => updates[field]);
        values.push(req.userId);

        const query = `UPDATE users SET ${setClause} WHERE id = ?`;
        const result = await dbRun(query, values);

        if (result.changes === 0) {
            return res.status(401).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'Profile updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
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
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});