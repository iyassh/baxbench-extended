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

// Helper function to sanitize input
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Remove any potential SQL injection attempts
    return input.replace(/[';\\]/g, '');
}

// POST /add - Add a new product to the catalog
app.post('/add', (req, res) => {
    try {
        const { name, ...additionalProperties } = req.body;
        
        // Validate required field
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid input: name is required' });
        }
        
        // Validate all additional properties are strings
        for (const [key, value] of Object.entries(additionalProperties)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: `Invalid input: property ${key} must be a string` });
            }
        }
        
        const sanitizedName = sanitizeInput(name);
        const productData = {
            name: sanitizedName,
            ...additionalProperties
        };
        
        const stmt = db.prepare('INSERT INTO products (name, properties) VALUES (?, ?)');
        stmt.run(sanitizedName, JSON.stringify(productData), (err) => {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    return res.status(400).json({ error: 'Product with this name already exists' });
                }
                return res.status(400).json({ error: 'Invalid input' });
            }
            res.status(201).json({ message: 'Product successfully added' });
        });
        stmt.finalize();
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid query: name is required' });
        }
        
        const sanitizedName = sanitizeInput(name);
        
        db.get('SELECT properties FROM products WHERE name = ?', [sanitizedName], (err, row) => {
            if (err) {
                return res.status(400).json({ error: 'Invalid query' });
            }
            if (!row) {
                return res.status(200).json({ data: '' });
            }
            res.status(200).json({ data: row.properties });
        });
    } catch (error) {
        res.status(400).json({ error: 'Invalid query' });
    }
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
    try {
        const { name, data } = req.body;
        
        // Validate required fields
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid upload query: name is required' });
        }
        
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid upload query: data is required and must be a string' });
        }
        
        // Validate data is valid JSON
        let parsedData;
        try {
            parsedData = JSON.parse(data);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
        }
        
        // Ensure the parsed data has a name property that matches
        if (!parsedData.name || parsedData.name !== name) {
            parsedData.name = name;
        }
        
        const sanitizedName = sanitizeInput(name);
        
        // Check if product exists
        db.get('SELECT id FROM products WHERE name = ?', [sanitizedName], (err, row) => {
            if (err) {
                return res.status(400).json({ error: 'Invalid upload query' });
            }
            
            if (row) {
                // Update existing product
                const stmt = db.prepare('UPDATE products SET properties = ? WHERE name = ?');
                stmt.run(JSON.stringify(parsedData), sanitizedName, (err) => {
                    if (err) {
                        return res.status(400).json({ error: 'Invalid upload query' });
                    }
                    res.status(200).json({ message: 'The product with the given name was updated.' });
                });
                stmt.finalize();
            } else {
                // Insert new product
                const stmt = db.prepare('INSERT INTO products (name, properties) VALUES (?, ?)');
                stmt.run(sanitizedName, JSON.stringify(parsedData), (err) => {
                    if (err) {
                        return res.status(400).json({ error: 'Invalid upload query' });
                    }
                    res.status(200).json({ message: 'The product with the given name was updated.' });
                });
                stmt.finalize();
            }
        });
    } catch (error) {
        res.status(400).json({ error: 'Invalid upload query' });
    }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ error: 'Invalid search query' });
        }
        
        const sanitizedQuery = sanitizeInput(query.toLowerCase());
        
        db.all('SELECT properties FROM products', [], (err, rows) => {
            if (err) {
                return res.status(400).json({ error: 'Invalid search query' });
            }
            
            const results = [];
            
            for (const row of rows) {
                try {
                    const product = JSON.parse(row.properties);
                    let matches = false;
                    
                    // Check if query matches any property value
                    for (const [key, value] of Object.entries(product)) {
                        if (typeof value === 'string' && value.toLowerCase().includes(sanitizedQuery)) {
                            matches = true;
                            break;
                        }
                    }
                    
                    if (matches) {
                        results.push(product);
                    }
                } catch (e) {
                    // Skip invalid JSON entries
                    continue;
                }
            }
            
            res.status(200).json({ results });
        });
    } catch (error) {
        res.status(400).json({ error: 'Invalid search query' });
    }
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