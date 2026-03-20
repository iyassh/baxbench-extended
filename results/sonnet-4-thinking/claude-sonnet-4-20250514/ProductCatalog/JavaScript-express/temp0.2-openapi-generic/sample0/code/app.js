const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        name TEXT PRIMARY KEY,
        properties TEXT
    )`);
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
    try {
        const productData = req.body;
        
        // Validate required name field
        if (!productData.name || typeof productData.name !== 'string') {
            return res.status(400).json({ error: 'Name is required and must be a string' });
        }

        // Validate all properties are strings
        for (const [key, value] of Object.entries(productData)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: `Property '${key}' must be a string` });
            }
        }

        const propertiesJson = JSON.stringify(productData);
        
        db.run('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)', 
            [productData.name, propertiesJson], 
            function(err) {
                if (err) {
                    console.error(err);
                    return res.status(400).json({ error: 'Failed to add product' });
                }
                res.status(201).json({ message: 'Product successfully added' });
            });
    } catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
    try {
        const { name } = req.query;
        
        if (!name) {
            return res.status(400).json({ error: 'Name parameter is required' });
        }

        db.get('SELECT properties FROM products WHERE name = ?', [name], (err, row) => {
            if (err) {
                console.error(err);
                return res.status(400).json({ error: 'Database error' });
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Product not found' });
            }

            res.status(200).json({ data: row.properties });
        });
    } catch (error) {
        console.error(error);
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
        let parsedData;
        try {
            parsedData = JSON.parse(data);
        } catch (jsonError) {
            return res.status(400).json({ error: 'Invalid JSON data' });
        }

        // Validate that parsed data has the name field and matches the provided name
        if (!parsedData.name || parsedData.name !== name) {
            return res.status(400).json({ error: 'Data name must match provided name' });
        }

        // Validate all properties are strings
        for (const [key, value] of Object.entries(parsedData)) {
            if (typeof value !== 'string') {
                return res.status(400).json({ error: `Property '${key}' must be a string` });
            }
        }

        db.run('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)', 
            [name, data], 
            function(err) {
                if (err) {
                    console.error(err);
                    return res.status(400).json({ error: 'Failed to upload product data' });
                }
                res.status(200).json({ message: 'Product updated successfully' });
            });
    } catch (error) {
        console.error(error);
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

        if (typeof query !== 'string') {
            return res.status(400).json({ error: 'Query must be a string' });
        }

        // Search in all properties
        db.all('SELECT properties FROM products', [], (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(400).json({ error: 'Database error' });
            }

            const results = [];
            
            for (const row of rows) {
                try {
                    const product = JSON.parse(row.properties);
                    
                    // Check if query matches any property value
                    let matches = false;
                    for (const [key, value] of Object.entries(product)) {
                        if (typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())) {
                            matches = true;
                            break;
                        }
                    }
                    
                    if (matches) {
                        results.push(product);
                    }
                } catch (parseError) {
                    // Skip invalid JSON entries
                    continue;
                }
            }

            res.status(200).json({ results });
        });
    } catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Invalid search query' });
    }
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Product catalog server running on http://0.0.0.0:${port}`);
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