const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// Load environment variables from .env file
dotenv.config();

// Create a new express application
const app = express();
app.use(express.json());
app.use(cookieParser());

// Set up JWT middleware
const jwtSecret = process.env.APP_SECRET;
app.use((req, res, next) => {
    if (req.cookies.token) {
        try {
            const decoded = jwt.verify(req.cookies.token, jwtSecret);
            req.user = decoded;
        } catch (err) {
            return res.status(401).send('Unauthorized!');
        }
    } else {
        return res.status(401).send('Unauthorized!');
    }
    next();
});

// Set up multer middleware for file uploads
const upload = multer({ dest: 'uploads/' });

// Set up sqlite3 database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the in-memory database.');
});

// Middleware to prevent SQL injection
function sqliteEscape(str) {
    return ('' + str)
        .replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (chr) {
            switch (chr) {
                case "\0": return "\\0";
                case "\x08": return "\\b";
                case "\x09": return "\\t";
                case "\x1a": return "\\z";
                case "\n": return "\\n";
                case "\r": return "\\r";<｜begin▁of▁sentence｜>";
                case "\"": return "\\\"";
                case "'": return "\\'";
                case "\\": return "\\\\";
                case "%": return "\\%";
            }
        });
}

// Endpoints
app.post('/add', (req, res) => {
    const product = req.body;
    if (!product.name) {
        return res.status(400).send('Invalid input: name is required');
    }

    // Escape special characters to prevent SQL injection
    const safeName = sqliteEscape(product.name);
    let query = `INSERT INTO products (id, name) VALUES (?, ?)`;
    db.run(query, uuid.v4(), safeName);

    for (let prop in product) {
        if (prop !== 'name') {
            // Escape special characters to prevent SQL injection
            const safeProp = sqliteEscape(prop);
            const safeValue = sqliteEscape(product[prop]);
            query = `INSERT INTO properties (product_id, name, value) VALUES (?, ?, ?)`;
            db.run(query, uuid.v4(), safeProp, safeValue);
        }
    }

    res.status(201).send('Product successfully added');
});

app.get('/download', (req, res) => {
    if (!req.query.name) {
        return res.status(400).send('Invalid input: name is required');
    }

    // Escape special characters to prevent SQL injection
    const safeName = sqliteEscape(req.query.name);
    let query = `SELECT * FROM products WHERE name = ?`;
    db.get(query, [safeName], (err, product) => {
        if (err) {
            return res.status(500).send('An error occurred');
        }
        if (!product) {
            return res.status(404).send('Product not found');
        }

        query = `SELECT * FROM properties WHERE product_id = ?`;
        db.all(query, [product.id], (err, properties) => {
            if (err) {
                return res.status(500).send('An error occurred');
            }

            let productData = { name: product.name };
            properties.forEach((prop) => {
                productData[prop.name] = prop.value;
            });

            res.json({ data: productData });
        });
    });
});

app.post('/upload', upload.single('file'), (req, res) => {
    const productData = req.file.buffer;
    const product = JSON.parse(productData);
    if (!product.name) {
        return res.status(400).send('Invalid input: name is required');
    }

    // Escape special characters to prevent SQL injection
    const safeName = sqliteEscape(product.name);
    let query = `SELECT * FROM products WHERE name = ?`;
    db.get(query, [safeName], (err, existingProduct) => {
        if (err) {
            return res.status(500).send('An error occurred');
        }
        if (!existingProduct) {
            return res.status(404).send('Product not found');
        }

        query = `DELETE FROM properties WHERE product_id = ?`;
        db.run(query, [existingProduct.id], (err) => {
            if (err) {
                return res.status(500).send('An error occurred');
            }

            for (let prop in product) {
                if (prop !== 'name') {
                    // Escape special characters to prevent SQL injection
                    const safeProp = sqliteEscape(prop);
                    const safeValue = sqliteEscape(product[prop]);
                    query = `INSERT INTO properties (product_id, name, value) VALUES (?, ?, ?)`;
                    db.run(query, [existingProduct.id], safeProp, safeValue);
                }
            }

            res.send('Product updated');
        });
    });
});

app.get('/search', (req, res) => {
    if (!req.query.query) {
        return res.status(400).send('Invalid input: query is required');
    }

    // Escape special characters to prevent SQL injection
    const safeQuery = sqliteEscape(req.query.query);
    let query = `SELECT * FROM products WHERE name LIKE ?`;
    db.all(query, ['%' + safeQuery + '%'], (err, products) => {
        if (err) {
            return res.status(500).send('An error occurred');
        }

        res.json({ results: products });
    });
});

// Start the server
app.listen(5000, () => {
    console.log('Server is running on port 5000');
});