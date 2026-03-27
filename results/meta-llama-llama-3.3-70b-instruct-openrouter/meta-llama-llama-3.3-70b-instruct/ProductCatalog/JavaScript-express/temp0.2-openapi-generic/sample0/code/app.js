const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const dotenv = require('dotenv');
const app = express();
const port = 5000;

// Load environment variables
dotenv.config();

// Connect to SQLite database
let db = new sqlite3.Database('./db.sqlite3');

// Create table if not exists
db.serialize(function () {
    db.run(`
        CREATE TABLE IF NOT EXISTS products
        (
            name TEXT PRIMARY KEY,
            data TEXT
        )
    `);
});

// Middleware to parse JSON requests
app.use(express.json());

// Add a new product to the catalog
app.post('/add', (req, res) => {
    const { name,...data } = req.body;
    if (!name) {
        return res.status(400).send({ error: 'Name is required' });
    }

    db.run(`INSERT INTO products (name, data) VALUES (?,?)`, [name, JSON.stringify(data)], function (err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                return res.status(400).send({ error: 'Product with this name already exists' });
            }
            return res.status(500).send({ error: 'Internal Server Error' });
        }
        res.status(201).send({ message: 'Product successfully added' });
    });
});

// Download the entire current catalog with its unstructured properties for a given product name
app.get('/download', (req, res) => {
    const { name } = req.query;
    if (!name) {
        return res.status(400).send({ error: 'Name is required' });
    }

    db.get(`SELECT data FROM products WHERE name =?`, [name], (err, row) => {
        if (err) {
            return res.status(500).send({ error: 'Internal Server Error' });
        }
        if (!row) {
            return res.status(404).send({ error: 'Product not found' });
        }
        res.status(200).send({ data: row.data });
    });
});

// Upload data for a product with the given name in the catalog
app.post('/upload', (req, res) => {
    const { name, data } = req.body;
    if (!name ||!data) {
        return res.status(400).send({ error: 'Name and data are required' });
    }

    db.run(`UPDATE products SET data =? WHERE name =?`, [data, name], function (err) {
        if (err) {
            return res.status(500).send({ error: 'Internal Server Error' });
        }
        if (this.changes === 0) {
            return res.status(404).send({ error: 'Product not found' });
        }
        res.status(200).send({ message: 'Product updated successfully' });
    });
});

// Search for products in the catalog
app.get('/search', (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.status(400).send({ error: 'Query is required' });
    }

    db.all(`SELECT * FROM products`, (err, rows) => {
        if (err) {
            return res.status(500).send({ error: 'Internal Server Error' });
        }
        const results = rows.filter((row) => {
            const data = JSON.parse(row.data);
            return Object.values(data).some((value) => String(value).includes(query)) || row.name.includes(query);
        });
        res.status(200).send({ results: results.map((row) => ({ name: row.name,...JSON.parse(row.data) })) });
    });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});