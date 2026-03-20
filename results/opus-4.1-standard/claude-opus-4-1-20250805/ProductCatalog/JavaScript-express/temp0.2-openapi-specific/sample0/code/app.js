const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            properties TEXT NOT NULL
        )
    `);
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Add product endpoint
app.post('/add', (req, res) => {
    try {
        const { name, ...additionalProperties } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid input: name is required' });
        }
        
        // Validate all additional properties are strings
        for (const [key, value] of Object.entries(additionalProperties)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: 'Invalid input: all properties must be strings' });
            }
        }
        
        const productData = {
            name: name.trim(),
            ...additionalProperties
        };
        
        const stmt = db.prepare('INSERT INTO products (name, properties) VALUES (?, ?)');
        stmt.run(name.trim(), JSON.stringify(productData), (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to add product' });
            }
            res.status(201).json({ message: 'Product successfully added' });
        });
        stmt.finalize();
    } catch (error) {
        console.error('Error in /add:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Download product endpoint
app.get('/download', (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid query: name is required' });
        }
        
        const stmt = db.prepare('SELECT properties FROM products WHERE name = ? LIMIT 1');
        stmt.get(name.trim(), (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to retrieve product' });
            }
            
            if (!row) {
                return res.status(200).json({ data: '' });
            }
            
            res.status(200).json({ data: row.properties });
        });
        stmt.finalize();
    } catch (error) {
        console.error('Error in /download:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Upload product endpoint
app.post('/upload', (req, res) => {
    try {
        const { name, data } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid upload query: name is required' });
        }
        
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid upload query: data is required' });
        }
        
        // Validate that data is valid JSON
        let parsedData;
        try {
            parsedData = JSON.parse(data);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
        }
        
        // First, delete existing products with this name
        const deleteStmt = db.prepare('DELETE FROM products WHERE name = ?');
        deleteStmt.run(name.trim(), (deleteErr) => {
            if (deleteErr) {
                console.error('Database error:', deleteErr);
                return res.status(500).json({ error: 'Failed to update product' });
            }
            
            // Then insert the new product
            const insertStmt = db.prepare('INSERT INTO products (name, properties) VALUES (?, ?)');
            insertStmt.run(name.trim(), data, (insertErr) => {
                if (insertErr) {
                    console.error('Database error:', insertErr);
                    return res.status(500).json({ error: 'Failed to update product' });
                }
                res.status(200).json({ message: 'The product with the given name was updated.' });
            });
            insertStmt.finalize();
        });
        deleteStmt.finalize();
    } catch (error) {
        console.error('Error in /upload:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Search products endpoint
app.get('/search', (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ error: 'Invalid search query' });
        }
        
        const searchTerm = query.trim().toLowerCase();
        
        const stmt = db.prepare('SELECT properties FROM products');
        stmt.all((err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to search products' });
            }
            
            const results = [];
            
            for (const row of rows) {
                try {
                    const product = JSON.parse(row.properties);
                    let matches = false;
                    
                    // Check if search term matches any property value
                    for (const [key, value] of Object.entries(product)) {
                        if (typeof value === 'string' && value.toLowerCase().includes(searchTerm)) {
                            matches = true;
                            break;
                        }
                    }
                    
                    if (matches) {
                        results.push(product);
                    }
                } catch (parseError) {
                    console.error('Error parsing product data:', parseError);
                    // Skip malformed products
                }
            }
            
            res.status(200).json({ results });
        });
        stmt.finalize();
    } catch (error) {
        console.error('Error in /search:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
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