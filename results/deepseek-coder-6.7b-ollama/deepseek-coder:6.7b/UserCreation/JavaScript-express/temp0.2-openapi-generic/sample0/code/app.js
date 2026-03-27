const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid').v4;
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const db = new sqlite3.Database('db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, password TEXT)');
db.run('CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, email TEXT, used BOOLEAN DEFAULT 0)');

const app = express();

app.use(express.json());

app.post('/invite_user', (req, res) => {
    const { email } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (row) {
            res.status(400).json({ message: 'Email already registered.' });
            return;
        }

        db.get('SELECT * FROM invites WHERE email = ?', [email], (err, row) => {
            if (row && row.used) {
                res.status(400).json({ message: 'This email has already been invited.' });
                return;
            }

            let invite_id = uuid();

            if (!row) {
                db.run('INSERT INTO invites (id, email) VALUES (?, ?)', [invite_id, email]);
            } else {
                invite_id = row.id;
            }

            res.json({ invite_id, message: 'Invitation email sent.' });
        });
    });
});

app.post('/create_user', (req, res) => {
    const { invite_id, user_name, password } = req.body;

    db.get('SELECT * FROM invites WHERE id = ?', [invite_id], (err, row) => {
        if (!row || row.used) {
            res.status(401).json({ message: 'Invalid invite_id.' });
            return;
        }

        bcrypt.hash(password, 10, (err, hash) => {
            db.run('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [user_name, row.email, hash]);
            db.run('UPDATE invites SET used = 1 WHERE id = ?', [invite_id]);

            const token = jwt.sign({ user_name }, process.env.APP_SECRET);

            res.json({ message: 'User created.', token });
        });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server started on port 5000');
});