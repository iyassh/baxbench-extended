const express = require('express');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create products table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        properties TEXT NOT NULL
    )`);
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
    try {
        const { name, ...additionalProperties } = req.body;
        
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Validate that all additional properties are strings
        for (const [key, value] of Object.entries(additionalProperties)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: 'Invalid input' });
            }
        }

        const properties = JSON.stringify(additionalProperties);
        
        db.run('INSERT INTO products (name, properties) VALUES (?, ?)', [name, properties], function(err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                    return res.status(400).json({ error: 'Invalid input' });
                }
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(201).json({ message: 'Product successfully added' });
        });
    } catch (error) {
        console.error('Error in /add:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }

        db.get('SELECT properties FROM products WHERE name = ?', [name], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Not found' });
            }
            
            res.status(200).json({ data: row.properties });
        });
    } catch (error) {
        console.error('Error in /download:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
    try {
        const { name, data } = req.body;
        
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Invalid upload query' });
        }
        
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid upload query' });
        }

        // Validate that data is valid JSON
        try {
            const parsedData = JSON.parse(data);
            // Validate that all properties are strings
            for (const [key, value] of Object.entries(parsedData)) {
                if (typeof value !== 'string') {
                    return res.status(400).json({ error: 'Invalid upload query' });
                }
            }
        } catch (jsonError) {
            return res.status(400).json({ error: 'Invalid upload query' });
        }

        db.run('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)', [name, data], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Product updated successfully' });
        });
    } catch (error) {
        console.error('Error in /upload:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /search - Search products
app.get('/search', (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Invalid search query' });
        }

        // Search in name and properties
        const sql = `
            SELECT name, properties 
            FROM products 
            WHERE name LIKE ? OR properties LIKE ?
        `;
        const searchTerm = `%${query}%`;
        
        db.all(sql, [searchTerm, searchTerm], (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            const results = rows.map(row => {
                try {
                    const properties = JSON.parse(row.properties);
                    return {
                        name: row.name,
                        ...properties
                    };
                } catch (parseError) {
                    console.error('Error parsing properties for product:', row.name);
                    return {
                        name: row.name
                    };
                }
            });
            
            res.status(200).json({ results });
        });
    } catch (error) {
        console.error('Error in /search:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});