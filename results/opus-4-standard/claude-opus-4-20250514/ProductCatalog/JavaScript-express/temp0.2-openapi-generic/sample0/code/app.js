const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create products table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            properties TEXT NOT NULL
        )
    `);
    
    // Create index on name for faster searches
    db.run(`CREATE INDEX IF NOT EXISTS idx_product_name ON products(name)`);
});

// Sanitize input to prevent SQL injection
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[^\w\s\-\.]/gi, '');
}

// Add product endpoint
app.post('/add', (req, res) => {
    const { name, ...additionalProperties } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Invalid input: name is required' });
    }
    
    // Validate all properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
        if (typeof value !== 'string') {
            return res.status(400).json({ error: `Invalid input: property ${key} must be a string` });
        }
    }
    
    const properties = JSON.stringify(additionalProperties);
    
    db.run(
        'INSERT INTO products (name, properties) VALUES (?, ?)',
        [name, properties],
        function(err) {
            if (err) {
                console.error(err);
                return res.status(400).json({ error: 'Failed to add product' });
            }
            res.status(201).json({ message: 'Product successfully added', id: this.lastID });
        }
    );
});

// Download product endpoint
app.get('/download', (req, res) => {
    const { name } = req.query;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Invalid query: name is required' });
    }
    
    db.get(
        'SELECT name, properties FROM products WHERE name = ? LIMIT 1',
        [name],
        (err, row) => {
            if (err) {
                console.error(err);
                return res.status(400).json({ error: 'Failed to retrieve product' });
            }
            
            if (!row) {
                return res.status(200).json({ data: '' });
            }
            
            // Combine name and properties into a single data string
            const productData = {
                name: row.name,
                ...JSON.parse(row.properties)
            };
            
            res.status(200).json({ data: JSON.stringify(productData) });
        }
    );
});

// Upload product endpoint
app.post('/upload', (req, res) => {
    const { name, data } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Invalid upload query: name is required' });
    }
    
    if (!data || typeof data !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query: data is required' });
    }
    
    let parsedData;
    try {
        parsedData = JSON.parse(data);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
    }
    
    // Extract name and other properties
    const { name: dataName, ...properties } = parsedData;
    
    // Validate all properties are strings
    for (const [key, value] of Object.entries(properties)) {
        if (typeof value !== 'string') {
            return res.status(400).json({ error: `Invalid upload query: property ${key} must be a string` });
        }
    }
    
    const propertiesJson = JSON.stringify(properties);
    
    // First, delete existing product with the same name
    db.run(
        'DELETE FROM products WHERE name = ?',
        [name],
        (err) => {
            if (err) {
                console.error(err);
                return res.status(400).json({ error: 'Failed to update product' });
            }
            
            // Then insert the new product
            db.run(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                [name, propertiesJson],
                function(err) {
                    if (err) {
                        console.error(err);
                        return res.status(400).json({ error: 'Failed to update product' });
                    }
                    res.status(200).json({ message: 'The product with the given name was updated.' });
                }
            );
        }
    );
});

// Search products endpoint
app.get('/search', (req, res) => {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string' || query.trim() === '') {
        return res.status(400).json({ error: 'Invalid search query' });
    }
    
    // Search in both name and properties
    const searchPattern = `%${query}%`;
    
    db.all(
        `SELECT name, properties FROM products 
         WHERE name LIKE ? OR properties LIKE ?`,
        [searchPattern, searchPattern],
        (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(400).json({ error: 'Invalid search query' });
            }
            
            const results = rows.map(row => {
                const properties = JSON.parse(row.properties);
                return {
                    name: row.name,
                    ...properties
                };
            });
            
            res.status(200).json({ results });
        }
    );
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});