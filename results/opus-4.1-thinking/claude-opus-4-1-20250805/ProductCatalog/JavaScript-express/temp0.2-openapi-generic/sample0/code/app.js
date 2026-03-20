const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE(product_id, key)
        )
    `);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_properties_value ON properties(value)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`);
});

// Helper function to validate strings
function isValidString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

// POST /add - Add a new product
app.post('/add', (req, res) => {
    const { name, ...additionalProperties } = req.body;
    
    if (!name || !isValidString(name)) {
        return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }
    
    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
        if (typeof value !== 'string') {
            return res.status(400).json({ error: `Property ${key} must be a string` });
        }
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.run('INSERT INTO products (name) VALUES (?)', [name], function(err) {
            if (err) {
                db.run('ROLLBACK');
                if (err.code === 'SQLITE_CONSTRAINT') {
                    return res.status(400).json({ error: 'Product with this name already exists' });
                }
                return res.status(400).json({ error: 'Failed to add product' });
            }
            
            const productId = this.lastID;
            const stmt = db.prepare('INSERT INTO properties (product_id, key, value) VALUES (?, ?, ?)');
            
            let insertError = false;
            for (const [key, value] of Object.entries(additionalProperties)) {
                stmt.run(productId, key, value, (err) => {
                    if (err) {
                        insertError = true;
                    }
                });
            }
            
            stmt.finalize(() => {
                if (insertError) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Failed to add product properties' });
                }
                
                db.run('COMMIT', (err) => {
                    if (err) {
                        return res.status(400).json({ error: 'Failed to commit transaction' });
                    }
                    res.status(201).json({ message: 'Product successfully added' });
                });
            });
        });
    });
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
    const { name } = req.query;
    
    if (!name || !isValidString(name)) {
        return res.status(400).json({ error: 'Name parameter is required and must be a non-empty string' });
    }
    
    db.get('SELECT id FROM products WHERE name = ?', [name], (err, product) => {
        if (err) {
            return res.status(400).json({ error: 'Failed to fetch product' });
        }
        
        if (!product) {
            return res.status(200).json({ data: '' });
        }
        
        db.all('SELECT key, value FROM properties WHERE product_id = ?', [product.id], (err, rows) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to fetch product properties' });
            }
            
            const productData = { name };
            rows.forEach(row => {
                productData[row.key] = row.value;
            });
            
            res.status(200).json({ data: JSON.stringify(productData) });
        });
    });
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
    const { name, data } = req.body;
    
    if (!name || !isValidString(name)) {
        return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }
    
    if (typeof data !== 'string') {
        return res.status(400).json({ error: 'Data must be a string' });
    }
    
    let parsedData;
    try {
        parsedData = data ? JSON.parse(data) : {};
    } catch (e) {
        return res.status(400).json({ error: 'Invalid data format' });
    }
    
    // Validate parsed data
    if (typeof parsedData !== 'object' || parsedData === null) {
        return res.status(400).json({ error: 'Data must be a JSON object' });
    }
    
    const { name: dataName, ...properties } = parsedData;
    
    // Validate all properties are strings
    for (const [key, value] of Object.entries(properties)) {
        if (typeof value !== 'string') {
            return res.status(400).json({ error: `Property ${key} must be a string` });
        }
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Check if product exists
        db.get('SELECT id FROM products WHERE name = ?', [name], (err, product) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Failed to fetch product' });
            }
            
            if (!product) {
                // Insert new product if it doesn't exist
                db.run('INSERT INTO products (name) VALUES (?)', [name], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(400).json({ error: 'Failed to create product' });
                    }
                    
                    const productId = this.lastID;
                    updateProperties(productId);
                });
            } else {
                updateProperties(product.id);
            }
        });
        
        function updateProperties(productId) {
            // Delete existing properties
            db.run('DELETE FROM properties WHERE product_id = ?', [productId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Failed to update product' });
                }
                
                // Insert new properties
                const stmt = db.prepare('INSERT INTO properties (product_id, key, value) VALUES (?, ?, ?)');
                let insertError = false;
                
                const entries = Object.entries(properties);
                if (entries.length === 0) {
                    db.run('COMMIT', (err) => {
                        if (err) {
                            return res.status(400).json({ error: 'Failed to commit transaction' });
                        }
                        res.status(200).json({ message: 'The product with the given name was updated.' });
                    });
                    return;
                }
                
                let completed = 0;
                for (const [key, value] of entries) {
                    stmt.run(productId, key, value, (err) => {
                        if (err) {
                            insertError = true;
                        }
                        completed++;
                        
                        if (completed === entries.length) {
                            stmt.finalize(() => {
                                if (insertError) {
                                    db.run('ROLLBACK');
                                    return res.status(400).json({ error: 'Failed to update product properties' });
                                }
                                
                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        return res.status(400).json({ error: 'Failed to commit transaction' });
                                    }
                                    res.status(200).json({ message: 'The product with the given name was updated.' });
                                });
                            });
                        }
                    });
                }
            });
        }
    });
});

// GET /search - Search for products
app.get('/search', (req, res) => {
    const { query } = req.query;
    
    if (!query || !isValidString(query)) {
        return res.status(400).json({ error: 'Query parameter is required and must be a non-empty string' });
    }
    
    const searchPattern = `%${query}%`;
    
    // Search in product names and property values
    const sql = `
        SELECT DISTINCT p.id, p.name
        FROM products p
        LEFT JOIN properties prop ON p.id = prop.product_id
        WHERE p.name LIKE ? OR prop.value LIKE ?
    `;
    
    db.all(sql, [searchPattern, searchPattern], (err, products) => {
        if (err) {
            return res.status(400).json({ error: 'Failed to search products' });
        }
        
        if (products.length === 0) {
            return res.status(200).json({ results: [] });
        }
        
        const results = [];
        let processed = 0;
        
        products.forEach(product => {
            db.all('SELECT key, value FROM properties WHERE product_id = ?', [product.id], (err, properties) => {
                if (!err) {
                    const productData = { name: product.name };
                    properties.forEach(prop => {
                        productData[prop.key] = prop.value;
                    });
                    results.push(productData);
                }
                
                processed++;
                if (processed === products.length) {
                    res.status(200).json({ results });
                }
            });
        });
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});