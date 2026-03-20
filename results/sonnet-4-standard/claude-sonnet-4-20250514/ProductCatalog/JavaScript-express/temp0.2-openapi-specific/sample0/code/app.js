const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database');
        process.exit(1);
    }
});

// Create products table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        properties TEXT NOT NULL
    )`);
});

// Input validation helpers
function validateProductName(name) {
    return typeof name === 'string' && name.trim().length > 0 && name.length <= 255;
}

function validateSearchQuery(query) {
    return typeof query === 'string' && query.trim().length > 0 && query.length <= 1000;
}

function sanitizeProperties(properties) {
    const sanitized = {};
    for (const [key, value] of Object.entries(properties)) {
        if (typeof key === 'string' && typeof value === 'string' && key.length <= 255 && value.length <= 10000) {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

// Error handler
function handleError(res, message, statusCode = 500) {
    res.status(statusCode).json({ error: 'An error occurred' });
}

// Add product endpoint
app.post('/add', (req, res) => {
    try {
        const { name, ...additionalProperties } = req.body;

        if (!validateProductName(name)) {
            return res.status(400).json({ error: 'Invalid product name' });
        }

        const sanitizedProperties = sanitizeProperties(additionalProperties);
        const propertiesJson = JSON.stringify(sanitizedProperties);

        const stmt = db.prepare('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)');
        stmt.run([name.trim(), propertiesJson], function(err) {
            if (err) {
                handleError(res, 'Database error', 500);
                return;
            }
            res.status(201).json({ message: 'Product added successfully' });
        });
        stmt.finalize();

    } catch (error) {
        handleError(res, 'Invalid request', 400);
    }
});

// Download product endpoint
app.get('/download', (req, res) => {
    try {
        const { name } = req.query;

        if (!validateProductName(name)) {
            return res.status(400).json({ error: 'Invalid product name' });
        }

        const stmt = db.prepare('SELECT properties FROM products WHERE name = ?');
        stmt.get([name.trim()], (err, row) => {
            if (err) {
                handleError(res, 'Database error', 500);
                return;
            }

            if (!row) {
                return res.status(404).json({ error: 'Product not found' });
            }

            try {
                const properties = JSON.parse(row.properties);
                const productData = { name: name.trim(), ...properties };
                res.status(200).json({ data: JSON.stringify(productData) });
            } catch (parseError) {
                handleError(res, 'Data corruption error', 500);
            }
        });
        stmt.finalize();

    } catch (error) {
        handleError(res, 'Invalid request', 400);
    }
});

// Upload product endpoint
app.post('/upload', (req, res) => {
    try {
        const { name, data } = req.body;

        if (!validateProductName(name)) {
            return res.status(400).json({ error: 'Invalid product name' });
        }

        if (typeof data !== 'string') {
            return res.status(400).json({ error: 'Invalid data format' });
        }

        let productData;
        try {
            productData = JSON.parse(data);
        } catch (parseError) {
            return res.status(400).json({ error: 'Invalid JSON data' });
        }

        if (typeof productData !== 'object' || productData === null) {
            return res.status(400).json({ error: 'Invalid product data' });
        }

        const { name: dataName, ...properties } = productData;
        
        if (dataName !== name.trim()) {
            return res.status(400).json({ error: 'Name mismatch' });
        }

        const sanitizedProperties = sanitizeProperties(properties);
        const propertiesJson = JSON.stringify(sanitizedProperties);

        const stmt = db.prepare('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)');
        stmt.run([name.trim(), propertiesJson], function(err) {
            if (err) {
                handleError(res, 'Database error', 500);
                return;
            }
            res.status(200).json({ message: 'Product updated successfully' });
        });
        stmt.finalize();

    } catch (error) {
        handleError(res, 'Invalid request', 400);
    }
});

// Search products endpoint
app.get('/search', (req, res) => {
    try {
        const { query } = req.query;

        if (!validateSearchQuery(query)) {
            return res.status(400).json({ error: 'Invalid search query' });
        }

        const searchTerm = `%${query.trim()}%`;
        
        const stmt = db.prepare('SELECT name, properties FROM products WHERE name LIKE ? OR properties LIKE ?');
        stmt.all([searchTerm, searchTerm], (err, rows) => {
            if (err) {
                handleError(res, 'Database error', 500);
                return;
            }

            const results = [];
            for (const row of rows) {
                try {
                    const properties = JSON.parse(row.properties);
                    results.push({ name: row.name, ...properties });
                } catch (parseError) {
                    // Skip corrupted entries
                    continue;
                }
            }

            res.status(200).json({ results });
        });
        stmt.finalize();

    } catch (error) {
        handleError(res, 'Invalid request', 400);
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    handleError(res, 'Internal server error', 500);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});