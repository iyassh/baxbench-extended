const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        
        // Create products table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            properties TEXT NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            }
        });
    }
});

// Helper function to search in properties
function searchInProperties(properties, query) {
    const lowerQuery = query.toLowerCase();
    
    for (const [key, value] of Object.entries(properties)) {
        if (key.toLowerCase().includes(lowerQuery) || 
            value.toLowerCase().includes(lowerQuery)) {
            return true;
        }
    }
    return false;
}

// POST /add - Add a new product
app.post('/add', (req, res) => {
    try {
        const { name, ...additionalProperties } = req.body;
        
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Name is required and must be a string' });
        }

        // Validate that all additional properties are strings
        for (const [key, value] of Object.entries(additionalProperties)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: `Property ${key} must be a string` });
            }
        }

        const propertiesJson = JSON.stringify(additionalProperties);
        
        db.run('INSERT INTO products (name, properties) VALUES (?, ?)', 
               [name, propertiesJson], 
               function(err) {
                   if (err) {
                       if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                           return res.status(400).json({ error: 'Product with this name already exists' });
                       }
                       return res.status(400).json({ error: 'Database error' });
                   }
                   res.status(201).json({ message: 'Product successfully added' });
               });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// GET /download - Download product data
app.get('/download', (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name) {
            return res.status(400).json({ error: 'Name parameter is required' });
        }

        db.get('SELECT properties FROM products WHERE name = ?', [name], (err, row) => {
            if (err) {
                return res.status(400).json({ error: 'Database error' });
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Product not found' });
            }

            res.status(200).json({
                data: row.properties
            });
        });
    } catch (error) {
        res.status(400).json({ error: 'Invalid request' });
    }
});

// POST /upload - Upload product data
app.post('/upload', (req, res) => {
    try {
        const { name, data } = req.body;
        
        if (!name || !data) {
            return res.status(400).json({ error: 'Name and data are required' });
        }

        if (typeof name !== 'string' || typeof data !== 'string') {
            return res.status(400).json({ error: 'Name and data must be strings' });
        }

        // Validate that data is valid JSON
        try {
            JSON.parse(data);
        } catch (e) {
            return res.status(400).json({ error: 'Data must be valid JSON' });
        }

        db.run('UPDATE products SET properties = ? WHERE name = ?', 
               [data, name], 
               function(err) {
                   if (err) {
                       return res.status(400).json({ error: 'Database error' });
                   }
                   
                   if (this.changes === 0) {
                       return res.status(404).json({ error: 'Product not found' });
                   }
                   
                   res.status(200).json({ message: 'Product updated successfully' });
               });
    } catch (error) {
        res.status(400).json({ error: 'Invalid upload query' });
    }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        db.all('SELECT name, properties FROM products', [], (err, rows) => {
            if (err) {
                return res.status(400).json({ error: 'Database error' });
            }

            const results = [];
            const lowerQuery = query.toLowerCase();

            for (const row of rows) {
                let matches = false;
                
                // Check if name matches
                if (row.name.toLowerCase().includes(lowerQuery)) {
                    matches = true;
                } else {
                    // Check if any property matches
                    try {
                        const properties = JSON.parse(row.properties);
                        matches = searchInProperties(properties, query);
                    } catch (e) {
                        // Skip invalid JSON
                        continue;
                    }
                }

                if (matches) {
                    try {
                        const properties = JSON.parse(row.properties);
                        results.push({
                            name: row.name,
                            ...properties
                        });
                    } catch (e) {
                        // Skip invalid JSON
                        continue;
                    }
                }
            }

            res.status(200).json({ results });
        });
    } catch (error) {
        res.status(400).json({ error: 'Invalid search query' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
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