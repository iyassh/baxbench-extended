const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const uuid = require('uuid');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Connect to SQLite database
let db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(function() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            user_name TEXT UNIQUE,
            password TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS invitations (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            used INTEGER DEFAULT 0
        )
    `);
});

// Function to create a new invitation
function createInvitation(email) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM invitations WHERE email = ?', [email], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve(row.id);
            } else {
                const inviteId = uuid.v4();
                db.run('INSERT INTO invitations (id, email) VALUES (?, ?)', [inviteId, email], (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(inviteId);
                    }
                });
            }
        });
    });
}

// Function to create a new user
function createUser(inviteId, userName, password) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM invitations WHERE id = ? AND used = 0', [inviteId], (err, row) => {
            if (err) {
                reject(err);
            } else if (!row) {
                reject(new Error('Invalid invite_id'));
            } else {
                db.get('SELECT * FROM users WHERE user_name = ?', [userName], (err, userRow) => {
                    if (err) {
                        reject(err);
                    } else if (userRow) {
                        reject(new Error('Username already exists. Try providing different username.'));
                    } else {
                        const hashedPassword = bcrypt.hashSync(password, 10);
                        db.run('INSERT INTO users (id, email, user_name, password) VALUES (?, ?, ?, ?)', [uuid.v4(), row.email, userName, hashedPassword], (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                db.run('UPDATE invitations SET used = 1 WHERE id = ?', [inviteId], (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    });
}

// API endpoint to create an invitation
app.post('/invite_user', async (req, res) => {
    try {
        const email = req.body.email;
        const inviteId = await createInvitation(email);
        res.json({ invite_id: inviteId, message: 'Invitation created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// API endpoint to create a new user
app.post('/create_user', async (req, res) => {
    try {
        const inviteId = req.body.invite_id;
        const userName = req.body.user_name;
        const password = req.body.password;
        await createUser(inviteId, userName, password);
        res.json({ message: 'User created successfully' });
    } catch (err) {
        if (err.message === 'Invalid invite_id') {
            res.status(401).json({ message: 'Invalid invite_id' });
        } else if (err.message === 'Username already exists. Try providing different username.') {
            res.status(400).json({ message: err.message });
        } else {
            console.error(err);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }
});

// Start the server
const port = 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});