const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table for products with dynamic properties stored as JSON
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            properties TEXT NOT NULL
        )
    `);
});

// POST /add - Add a new product to the catalog
app.post('/add', (req, res) => {
    const { name, ...additionalProperties } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Product name is required' });
    }
    
    // Store all properties including name as JSON
    const allProperties = { name, ...additionalProperties };
    
    db.run(
        'INSERT INTO products (name, properties) VALUES (?, ?)',
        [name, JSON.stringify(allProperties)],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Product with this name already exists' });
                }
                return res.status(400).json({ error: 'Invalid input' });
            }
            res.status(201).json({ message: 'Product successfully added' });
        }
    );
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
    const { name } = req.query;
    
    if (!name) {
        return res.status(400).json({ error: 'Product name is required' });
    }
    
    db.get(
        'SELECT properties FROM products WHERE name = ?',
        [name],
        (err, row) => {
            if (err) {
                return res.status(400).json({ error: 'Database error' });
            }
            if (!row) {
                return res.status(200).json({ data: '' });
            }
            res.status(200).json({ data: row.properties });
        }
    );
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
    const { name, data } = req.body;
    
    if (!name || !data) {
        return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    // Validate that data is valid JSON
    let parsedData;
    try {
        parsedData = JSON.parse(data);
        // Ensure the parsed data has a name property matching the provided name
        parsedData.name = name;
    } catch (e) {
        return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    // Check if product exists and update or insert accordingly
    db.get(
        'SELECT id FROM products WHERE name = ?',
        [name],
        (err, row) => {
            if (err) {
                return res.status(400).json({ error: 'Invalid upload query' });
            }
            
            if (row) {
                // Update existing product
                db.run(
                    'UPDATE products SET properties = ? WHERE name = ?',
                    [JSON.stringify(parsedData), name],
                    function(err) {
                        if (err) {
                            return res.status(400).json({ error: 'Invalid upload query' });
                        }
                        res.status(200).json({ message: 'The product with the given name was updated.' });
                    }
                );
            } else {
                // Insert new product
                db.run(
                    'INSERT INTO products (name, properties) VALUES (?, ?)',
                    [name, JSON.stringify(parsedData)],
                    function(err) {
                        if (err) {
                            return res.status(400).json({ error: 'Invalid upload query' });
                        }
                        res.status(200).json({ message: 'The product with the given name was updated.' });
                    }
                );
            }
        }
    );
});

// GET /search - Search for products
app.get('/search', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.status(400).json({ error: 'Invalid search query' });
    }
    
    // Search in all products
    db.all(
        'SELECT properties FROM products',
        [],
        (err, rows) => {
            if (err) {
                return res.status(400).json({ error: 'Invalid search query' });
            }
            
            const results = [];
            const searchLower = query.toLowerCase();
            
            for (const row of rows) {
                try {
                    const product = JSON.parse(row.properties);
                    let match = false;
                    
                    // Check if any property value contains the search query
                    for (const [key, value] of Object.entries(product)) {
                        if (String(value).toLowerCase().includes(searchLower)) {
                            match = true;
                            break;
                        }
                    }
                    
                    if (match) {
                        results.push(product);
                    }
                } catch (e) {
                    // Skip invalid JSON entries
                    continue;
                }
            }
            
            res.status(200).json({ results });
        }
    );
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});