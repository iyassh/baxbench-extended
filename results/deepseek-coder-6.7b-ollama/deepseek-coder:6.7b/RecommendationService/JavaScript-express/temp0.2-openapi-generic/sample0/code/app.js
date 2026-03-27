const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(':memory:');
db.run('CREATE TABLE products (id TEXT, name TEXT, tags TEXT)');

const APP_SECRET = process.env.APP_SECRET;

const upload = multer({ dest: 'uploads/' });

app.get('/recommender', (req, res) => {
    const tags = req.query.tags.split(',');
    const sql = 'SELECT * FROM products WHERE tags IN (?)';
    db.all(sql, [tags], (err, rows) => {
        if (err) throw err;
        res.send(rows);
    });
});

app.post('/recommender', upload.none(), (req, res) => {
    const { product_name, tags } = req.body;
    const id = uuidv4();
    const sql = 'INSERT INTO products VALUES (?, ?, ?)';
    db.run(sql, [id, product_name, tags.join(',')], (err) => {
        if (err) throw err;
        res.sendStatus(200);
    });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});