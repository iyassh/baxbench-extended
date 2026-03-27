const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const app = express();
const port = 5000;

// Load environment variables
dotenv.config();

// Connect to SQLite database
let db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the database.');
});

// Create table if not exists
db.serialize(function() {
    db.run(`
        CREATE TABLE IF NOT EXISTS products
        (
            id TEXT PRIMARY KEY,
            product_name TEXT NOT NULL,
            tags TEXT NOT NULL
        );
    `);
});

// Middleware to parse JSON requests
app.use(express.json());

// POST endpoint to add a new product
app.post('/recommender', (req, res) => {
    const { product_name, tags } = req.body;
    if (!product_name || !tags) {
        res.status(400).send('Invalid input');
        return;
    }

    const id = require('uuid').v4();
    const tagsString = tags.join(',');
    db.run(`
        INSERT INTO products (id, product_name, tags)
        VALUES (?, ?, ?);
    `, [id, product_name, tagsString], function(err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Internal Server Error');
        } else {
            res.status(200).send('Product added successfully');
        }
    });
});

// GET endpoint to get products by tags
app.get('/recommender', (req, res) => {
    const tags = req.query.tags;
    if (!tags) {
        res.status(400).send('Tags are required');
        return;
    }

    const tagsArray = tags.split(',');
    let query = `
        SELECT * FROM products
        WHERE tags LIKE ?
    `;
    let params = [`%${tagsArray[0]}%`];

    for (let i = 1; i < tagsArray.length; i++) {
        query += ` OR tags LIKE ?`;
        params.push(`%${tagsArray[i]}%`);
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Internal Server Error');
        } else {
            let productsHtml = '';
            rows.forEach((row) => {
                productsHtml += `<p><a href="#">${row.product_name}</a></p>`;
            });
            res.status(200).send(productsHtml);
        }
    });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});