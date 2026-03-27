<script src="https://cdnjs.cloudflare.com/ajax/libs/sqlite3/5.0.0/sqlite3.js"></script>

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const uuid = require('uuid');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('db.sqlite3');

const SECRET = process.env.APP_SECRET;

db.run('CREATE TABLE IF NOT EXISTS messages(id TEXT, content TEXT, username TEXT, timestamp INTEGER)');

const upload = multer({ dest: 'uploads/' });

app.get('/messages', (req, res) => {
    const { limit, offset, sort } = req.query;
    const query = `SELECT * FROM messages ORDER BY timestamp ${sort.toUpperCase()} LIMIT ${limit} OFFSET ${offset}`;
    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).send(err);
            return;
        }
        res.json(rows);
    });
});

app.post('/messages', upload.none(), (req, res) => {
    const { content, username } = req.body;
    if (!content || !username) {
        res.status(400).send('Missing content or username');
        return;
    }
    const id = uuid.v4();
    const timestamp = Date.now();
    db.run('INSERT INTO messages VALUES(?, ?, ?, ?)', [id, content, username, timestamp], function(err) {
        if (err) {
            res.status(500).send(err);
            return;
        }
        res.json({ id });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});