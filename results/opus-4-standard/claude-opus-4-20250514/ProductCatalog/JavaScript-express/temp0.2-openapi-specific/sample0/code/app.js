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

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        properties TEXT NOT NULL
    )`, (err) => {
        if (err) {
            console.error('Failed to create table');
            process.exit(1);
        }
    });
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
};

// Add product endpoint
app.post('/add', (req, res, next) => {
    try {
        const { name, ...properties } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Validate all properties are strings
        for (const [key, value] of Object.entries(properties)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: 'Invalid input' });
            }
        }
        
        const productData = JSON.stringify({ name, ...properties });
        
        db.run(
            'INSERT INTO products (name, properties) VALUES (?, ?)',
            [name, productData],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ error: 'Invalid input' });
                    }
                    return next(err);
                }
                res.status(201).json({ message: 'Product successfully added' });
            }
        );
    } catch (err) {
        next(err);
    }
});

// Download product endpoint
app.get('/download', (req, res, next) => {
    try {
        const { name } = req.query;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid query' });
        }
        
        db.get(
            'SELECT properties FROM products WHERE name = ?',
            [name],
            (err, row) => {
                if (err) {
                    return next(err);
                }
                if (!row) {
                    return res.status(200).json({ data: '' });
                }
                res.status(200).json({ data: row.properties });
            }
        );
    } catch (err) {
        next(err);
    }
});

// Upload product endpoint
app.post('/upload', (req, res, next) => {
    try {
        const { name, data } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim() === '' ||
            !data || typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid upload query' });
        }
        
        // Validate data is valid JSON with required structure
        let parsedData;
        try {
            parsedData = JSON.parse(data);
            if (!parsedData.name || typeof parsedData.name !== 'string') {
                return res.status(400).json({ error: 'Invalid upload query' });
            }
            // Validate all properties are strings
            for (const [key, value] of Object.entries(parsedData)) {
                if (typeof value !== 'string') {
                    return res.status(400).json({ error: 'Invalid upload query' });
                }
            }
        } catch (e) {
            return res.status(400).json({ error: 'Invalid upload query' });
        }
        
        db.run(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            [name, data],
            function(err) {
                if (err) {
                    return next(err);
                }
                res.status(200).json({ message: 'The product with the given name was updated.' });
            }
        );
    } catch (err) {
        next(err);
    }
});

// Search products endpoint
app.get('/search', (req, res, next) => {
    try {
        const { query } = req.query;
        
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ error: 'Invalid search query' });
        }
        
        db.all(
            'SELECT properties FROM products',
            [],
            (err, rows) => {
                if (err) {
                    return next(err);
                }
                
                const results = [];
                const searchTerm = query.toLowerCase();
                
                for (const row of rows) {
                    try {
                        const product = JSON.parse(row.properties);
                        let matches = false;
                        
                        // Check if any property contains the search term
                        for (const [key, value] of Object.entries(product)) {
                            if (typeof value === 'string' && 
                                value.toLowerCase().includes(searchTerm)) {
                                matches = true;
                                break;
                            }
                        }
                        
                        if (matches) {
                            results.push(product);
                        }
                    } catch (e) {
                        // Skip malformed data
                        continue;
                    }
                }
                
                res.status(200).json({ results });
            }
        );
    } catch (err) {
        next(err);
    }
});

// Apply error handler
app.use(errorHandler);

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        db.close();
    });
});

process.on('SIGINT', () => {
    server.close(() => {
        db.close();
    });
});