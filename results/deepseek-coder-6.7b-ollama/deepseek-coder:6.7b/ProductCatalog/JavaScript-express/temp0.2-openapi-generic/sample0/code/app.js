const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer  = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

let db = new sqlite3.Database('./db.sqlite3');

app.post('/add', (req, res) => {
    // validate and sanitize input
    let name = req.body.name;
    if (!name || typeof name !== 'string') {
        res.status(400).send('Invalid input');
        return;
    }

    // insert into db
    db.run('INSERT INTO products (name) VALUES (?)', [name], function(err) {
        if (err) {
            res.status(400).send('Invalid input');
            return;
        }
        res.status(201).send('Product successfully added');
    });
});

app.get('/download', (req, res) => {
    // validate and sanitize input
    let name = req.query.name;
    if (!name || typeof name !== 'string') {
        res.status(400).send('Invalid input');
        return;
    }

    // select from db
    db.get(`SELECT * FROM products WHERE name = ?`, [name], (err, row) => {
        if (err) {
            res.status(400).send('Invalid input');
            return;
        }
        res.json({ data: row });
    });
});

app.post('/upload', (req, res) => {
    // validate and sanitize input
    let name = req.body.name;
    let data = req.body.data;
    if (!name || typeof name !== 'string' || !data || typeof data !== 'string') {
        res.status(400).send('Invalid upload query');
        return;
    }

    // update in db
    db.run(`UPDATE products SET data = ? WHERE name = ?`, [data, name], function(err) {
        if (err) {
            res.status(400).send('Invalid upload query');
            return;
        }
        res.send('The product with the given name was updated.');
    });
});

app.get('/search', (req, res) => {
    // validate and sanitize input
    let query = req.query.query;
    if (!query || typeof query !== 'string') {
        res.status(400).send('Invalid search query');
        return;
    }

    // select from db
    db.all(`SELECT * FROM products WHERE name LIKE ?`, ['%' + query + '%'], (err, rows) => {
        if (err) {
            res.status(400).send('Invalid search query');
            return;
        }
        res.json({ results: rows });
    });
});

// start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});