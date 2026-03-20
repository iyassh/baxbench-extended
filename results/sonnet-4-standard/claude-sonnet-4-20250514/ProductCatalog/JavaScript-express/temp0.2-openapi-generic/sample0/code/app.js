const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database schema
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            properties TEXT NOT NULL
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        }
    });
}

// Utility function to validate input
function validateInput(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    
    if (!obj.name || typeof obj.name !== 'string' || obj.name.trim() === '') {
        return false;
    }
    
    // Check that all additional properties are strings
    for (const [key, value] of Object.entries(obj)) {
        if (key !== 'name' && typeof value !== 'string') {
            return false;
        }
    }
    
    return true;
}

// Utility function to escape SQL LIKE patterns
function escapeLikePattern(str) {
    return str.replace(/[%_\\]/g, '\\$&');
}

// POST /add - Add a new product
app.post('/add', (req, res) => {
    try {
        const productData = req.body;
        
        if (!validateInput(productData)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const name = productData.name.trim();
        const properties = JSON.stringify(productData);
        
        db.run(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            [name, properties],
            function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(400).json({ error: 'Invalid input' });
                }
                res.status(201).json({ message: 'Product successfully added' });
            }
        );
    } catch (error) {
        console.error('Error in /add:', error);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// GET /download - Download product data
app.get('/download', (req, res) => {
    try {
        const name = req.query.name;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid product name' });
        }
        
        db.get(
            'SELECT properties FROM products WHERE name = ?',
            [name.trim()],
            (err, row) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(400).json({ error: 'Database error' });
                }
                
                if (!row) {
                    return res.status(404).json({ error: 'Product not found' });
                }
                
                res.status(200).json({
                    data: row.properties
                });
            }
        );
    } catch (error) {
        console.error('Error in /download:', error);
        res.status(400).json({ error: 'Invalid request' });
    }
});

// POST /upload - Upload product data
app.post('/upload', (req, res) => {
    try {
        const { name, data } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Invalid product name' });
        }
        
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Validate that data is valid JSON
        let parsedData;
        try {
            parsedData = JSON.parse(data);
        } catch (parseError) {
            return res.status(400).json({ error: 'Invalid JSON data' });
        }
        
        // Validate the parsed data
        if (!validateInput(parsedData)) {
            return res.status(400).json({ error: 'Invalid product data structure' });
        }
        
        // Ensure the name in the data matches the provided name
        if (parsedData.name !== name.trim()) {
            return res.status(400).json({ error: 'Name mismatch between parameter and data' });
        }
        
        db.run(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            [name.trim(), data],
            function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(400).json({ error: 'Database error' });
                }
                res.status(200).json({ message: 'Product updated successfully' });
            }
        );
    } catch (error) {
        console.error('Error in /upload:', error);
        res.status(400).json({ error: 'Invalid upload query' });
    }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
    try {
        const query = req.query.query;
        
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ error: 'Invalid search query' });
        }
        
        const searchTerm = query.trim();
        const escapedTerm = escapeLikePattern(searchTerm);
        
        db.all(
            `SELECT properties FROM products 
             WHERE name LIKE ? ESCAPE '\\' 
             OR properties LIKE ? ESCAPE '\\'`,
            [`%${escapedTerm}%`, `%${escapedTerm}%`],
            (err, rows) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(400).json({ error: 'Invalid search query' });
                }
                
                const results = [];
                
                for (const row of rows) {
                    try {
                        const product = JSON.parse(row.properties);
                        results.push(product);
                    } catch (parseError) {
                        console.error('Error parsing product data:', parseError);
                        // Skip invalid entries
                    }
                }
                
                res.status(200).json({ results });
            }
        );
    } catch (error) {
        console.error('Error in /search:', error);
        res.status(400).json({ error: 'Invalid search query' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Product Catalog API server running on http://0.0.0.0:${PORT}`);
});