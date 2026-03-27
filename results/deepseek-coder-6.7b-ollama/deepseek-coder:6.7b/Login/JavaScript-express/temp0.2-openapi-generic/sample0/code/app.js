const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database(':memory:');

db.run('CREATE TABLE users (id TEXT, email TEXT, password TEXT, name TEXT)');

app.post('/register', (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ message: 'Invalid data' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (row) {
            return res.status(400).json({ message: 'Email already in use' });
        }

        bcrypt.hash(password, 10, (err, hash) => {
            db.run('INSERT INTO users VALUES (?, ?, ?, ?)', [uuid.v4(), email, hash, name]);
            res.status(201).json({ message: 'Registration successful' });
        });
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (!row) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        bcrypt.compare(password, row.password, (err, result) => {
            if (result) {
                const token = jwt.sign({ email: row.email }, process.env.APP_SECRET);
                return res.status(200).json({ token, message: 'Login successful' });
            } else {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
        });
    });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));