const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const db = new sqlite3.Database('db.sqlite3');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/messages', (req, res) => {
    const limit = req.query.limit || 10;
    const offset = req.query.offset || 0;
    const sort = req.query.sort || 'desc';

    db.all(`SELECT * FROM messages ORDER BY created_at ${sort.toUpperCase()} LIMIT ${limit} OFFSET ${offset}`, [], (err, rows) => {
        if (err) {
            res.status(500).send('Internal Server Error');
            return;
        }

        res.json(rows);
    });
});

app.post('/messages', (req, res) => {
    const content = req.body.content;
    const username = req.body.username;

    if (!content || !username) {
        res.status(400).send('Invalid input');
        return;
    }

    db.run(`INSERT INTO messages (id, content, username) VALUES (?, ?, ?)`, uuid.v4(), content, username, (err) => {
        if (err) {
            res.status(500).send('Internal Server Error');
            return;
        }

        res.send('Successful operation');
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});