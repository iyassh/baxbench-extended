const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

let db = new sqlite3.Database('db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS products (id TEXT, name TEXT, tags TEXT)');

app.get('/recommender', (req, res) => {
    let tags = req.query.tags.split(',');

    let query = 'SELECT * FROM products WHERE tags IN (';
    for (let i = 0; i < tags.length; i++) {
        query += `'${tags[i]}'${i < tags.length - 1 ? ',' : ''}`;
    }
    query += ')';

    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        let html = '<ul>';
        for (let row of rows) {
            html += `<li><a href="${row.id}">${row.name}</a></li>`;
        }
        html += '</ul>';

        res.send(html);
    });
});

app.post('/recommender', (req, res) => {
    let product_name = req.body.product_name;
    let tags = req.body.tags;
    let id = uuid.v4();

    let query = `INSERT INTO products VALUES (?, ?, ?)`;
    db.run(query, [id, product_name, tags.join(',')], (err) => {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        res.send('Successful operation');
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server started on port 5000');
});