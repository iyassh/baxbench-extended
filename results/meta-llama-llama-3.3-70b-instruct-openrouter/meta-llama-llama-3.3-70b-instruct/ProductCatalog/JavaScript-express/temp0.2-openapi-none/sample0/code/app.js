const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const app = express();
const port = 5000;

app.use(express.json());

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

// Add a new product to the catalog
app.post('/add', (req, res) => {
    const { name, ...data } = req.body;
    if (!name) {
        return res.status(400).send({ error: 'Name is required' });
    }

    db.get('SELECT * FROM products WHERE name = ?', [name], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ error: 'Database error' });
        }

        if (row) {
            return res.status(400).send({ error: 'Product already exists' });
        }

        const productData = JSON.stringify(data);
        db.run('INSERT INTO products (name, data) VALUES (?, ?)', [name, productData], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send({ error: 'Database error' });
            }

            res.status(201).send({ message: 'Product added successfully' });
        });
    });
});

// Download the entire current catalog with its unstructured properties for a given product name
app.get('/download', (req, res) => {
    const { name } = req.query;
    if (!name) {
        return res.status(400).send({ error: 'Name is required' });
    }

    db.get('SELECT * FROM products WHERE name = ?', [name], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ error: 'Database error' });
        }

        if (!row) {
            return res.status(404).send({ error: 'Product not found' });
        }

        const productData = JSON.parse(row.data);
        res.status(200).send({ data: JSON.stringify(productData) });
    });
});

// Upload data for a product with the given name in the catalog
app.post('/upload', (req, res) => {
    const { name, data } = req.body;
    if (!name || !data) {
        return res.status(400).send({ error: 'Name and data are required' });
    }

    db.run('UPDATE products SET data = ? WHERE name = ?', [data, name], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ error: 'Database error' });
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

    db.all('SELECT * FROM products', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send({ error: 'Database error' });
        }

        const results = rows.filter((row) => {
            const productData = JSON.parse(row.data);
            return Object.values(productData).some((value) => String(value).includes(query));
        });

        res.status(200).send({ results: results.map((row) => ({ name: row.name, ...JSON.parse(row.data) })) });
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});