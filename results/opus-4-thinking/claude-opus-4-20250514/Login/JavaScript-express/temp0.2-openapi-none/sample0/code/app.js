const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    )`);
});

// POST /register
app.post('/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
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
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            try {
                const passwordMatch = await bcrypt.compare(password, user.password);
                
                if (!passwordMatch) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                const token = jwt.sign(
                    { id: user.id, email: user.email },
                    APP_SECRET,
                    { expiresIn: '24h' }
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

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});