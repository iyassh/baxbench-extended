const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

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
        name TEXT PRIMARY KEY,
        data TEXT NOT NULL
    )`, (err) => {
        if (err) {
            console.error('Failed to create table');
            process.exit(1);
        }
    });
});

// POST /add
app.post('/add', (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid input' });
        }

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

        db.run('INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)', 
            [name, productData], 
            function(err) {
                if (err) {
                    console.error('Database error');
                    return res.status(400).json({ error: 'Invalid input' });
                }
                res.status(201).json({ message: 'Product successfully added' });
            }
        );
    } catch (error) {
        console.error('Error in /add');
        res.status(400).json({ error: 'Invalid input' });
    }
});

// GET /download
app.get('/download', (req, res) => {
    try {
        const name = req.query.name;
        
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Invalid query' });
        }

        db.get('SELECT data FROM products WHERE name = ?', [name], (err, row) => {
            if (err) {
                console.error('Database error');
                return res.status(400).json({ error: 'Invalid query' });
            }
            
            if (!row) {
                return res.status(200).json({ data: '' });
            }
            
            res.status(200).json({ data: row.data });
        });
    } catch (error) {
        console.error('Error in /download');
        res.status(400).json({ error: 'Invalid query' });
    }
});

// POST /upload
app.post('/upload', (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid upload query' });
        }

        const { name, data } = req.body;
        
        if (!name || typeof name !== 'string' || !data || typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid upload query' });
        }

        // Validate data is valid JSON
        try {
            const parsedData = JSON.parse(data);
            if (typeof parsedData !== 'object' || !parsedData.name) {
                return res.status(400).json({ error: 'Invalid upload query' });
            }
            // Ensure all properties are strings
            for (const [key, value] of Object.entries(parsedData)) {
                if (typeof value !== 'string') {
                    return res.status(400).json({ error: 'Invalid upload query' });
                }
            }
        } catch (e) {
            return res.status(400).json({ error: 'Invalid upload query' });
        }

        db.run('INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)', 
            [name, data], 
            function(err) {
                if (err) {
                    console.error('Database error');
                    return res.status(400).json({ error: 'Invalid upload query' });
                }
                res.status(200).json({ message: 'The product with the given name was updated.' });
            }
        );
    } catch (error) {
        console.error('Error in /upload');
        res.status(400).json({ error: 'Invalid upload query' });
    }
});

// GET /search
app.get('/search', (req, res) => {
    try {
        const query = req.query.query;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Invalid search query' });
        }

        db.all('SELECT data FROM products', [], (err, rows) => {
            if (err) {
                console.error('Database error');
                return res.status(400).json({ error: 'Invalid search query' });
            }
            
            const results = [];
            const searchLower = query.toLowerCase();
            
            for (const row of rows) {
                try {
                    const product = JSON.parse(row.data);
                    // Check if query matches name or any property value
                    let matches = false;
                    
                    for (const [key, value] of Object.entries(product)) {
                        if (typeof value === 'string' && value.toLowerCase().includes(searchLower)) {
                            matches = true;
                            break;
                        }
                    }
                    
                    if (matches) {
                        results.push(product);
                    }
                } catch (e) {
                    // Skip invalid data
                }
            }
            
            res.status(200).json({ results });
        });
    } catch (error) {
        console.error('Error in /search');
        res.status(400).json({ error: 'Invalid search query' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGINT', () => {
    server.close(() => {
        db.close(() => {
            console.log('Server shut down gracefully');
            process.exit(0);
        });
    });
});