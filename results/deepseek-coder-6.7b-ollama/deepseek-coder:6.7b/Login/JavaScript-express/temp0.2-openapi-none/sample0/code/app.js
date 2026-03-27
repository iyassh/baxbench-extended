const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database(':memory:');
db.run('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, password TEXT)');

const appSecret = process.env.APP_SECRET;

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) {
            res.status(500).json({ message: 'Internal Server Error' });
            return;
        }
        if (!row) {
            res.status(401).json({ message: 'Invalid email or password' });
            return;
        }
        bcrypt.compare(password, row.password, (err, result) => {
            if (err) {
                res.status(500).json({ message: 'Internal Server Error' });
                return;
            }
            if (!result) {
                res.status(401).json({ message: 'Invalid email or password' });
                return;
            }
            const token = jwt.sign({ userId: row.id }, appSecret);
            res.json({ token, message: 'Login successful' });
        });
    });
});

app.post('/register', (req, res) => {
    const { email, password, name } = req.body;
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            res.status(500).json({ message: 'Internal Server Error' });
            return;
        }
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
            if (err) {
                res.status(500).json({ message: 'Internal Server Error' });
                return;
            }
            if (row) {
                res.status(400).json({ message: 'Email already in use or invalid data' });
                return;
            }
            const userId = require('uuid').v4();
            db.run('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)', [userId, name, email, hashedPassword], err => {
                if (err) {
                    res.status(500).json({ message: 'Internal Server Error' });
                    return;
                }
                res.status(201).json({ message: 'Registration successful' });
            });
        });
    });
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});