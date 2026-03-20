const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none';");
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

// Create tables if they don't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        tag TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`);
});

// Helper function to escape HTML
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return '';
    }
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper function to validate input
function validateInput(input, type) {
    if (type === 'string') {
        return typeof input === 'string' && input.trim().length > 0;
    }
    if (type === 'array') {
        return Array.isArray(input) && input.length > 0 && input.every(item => typeof item === 'string' && item.trim().length > 0);
    }
    return false;
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    try {
        const tagsParam = req.query.tags;
        
        if (!tagsParam || typeof tagsParam !== 'string') {
            res.status(400).send('Invalid tags parameter');
            return;
        }

        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        
        if (tags.length === 0) {
            res.status(400).send('No valid tags provided');
            return;
        }

        // Create placeholders for parameterized query
        const placeholders = tags.map(() => '?').join(',');
        
        const query = `
            SELECT DISTINCT p.id, p.product_name 
            FROM products p 
            INNER JOIN product_tags pt ON p.id = pt.product_id 
            WHERE pt.tag IN (${placeholders})
            ORDER BY p.product_name
        `;

        db.all(query, tags, (err, rows) => {
            if (err) {
                console.error('Database error occurred');
                res.status(500).send('Internal server error');
                return;
            }

            let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Products matching tags: ${escapeHtml(tags.join(', '))}</p>
`;

            if (rows.length === 0) {
                html += '<p>No products found matching the specified tags.</p>';
            } else {
                html += '<ul>';
                rows.forEach(row => {
                    html += `<li>${escapeHtml(row.product_name)}</li>`;
                });
                html += '</ul>';
            }

            html += `
</body>
</html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        });

    } catch (error) {
        console.error('Unexpected error occurred');
        res.status(500).send('Internal server error');
    }
});

// POST /recommender - Add new product with tags
app.post('/recommender', (req, res) => {
    try {
        const { product_name, tags } = req.body;

        if (!validateInput(product_name, 'string')) {
            res.status(400).json({ error: 'Invalid product_name' });
            return;
        }

        if (!validateInput(tags, 'array')) {
            res.status(400).json({ error: 'Invalid tags array' });
            return;
        }

        // Sanitize inputs
        const sanitizedProductName = product_name.trim();
        const sanitizedTags = tags.map(tag => tag.trim()).filter(tag => tag.length > 0);

        if (sanitizedTags.length === 0) {
            res.status(400).json({ error: 'No valid tags provided' });
            return;
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run('INSERT INTO products (product_name) VALUES (?)', [sanitizedProductName], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error('Database error occurred');
                    res.status(500).json({ error: 'Internal server error' });
                    return;
                }

                const productId = this.lastID;
                let insertedTags = 0;
                let hasError = false;

                sanitizedTags.forEach(tag => {
                    if (hasError) return;

                    db.run('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', [productId, tag], (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            db.run('ROLLBACK');
                            console.error('Database error occurred');
                            res.status(500).json({ error: 'Internal server error' });
                            return;
                        }

                        insertedTags++;
                        if (insertedTags === sanitizedTags.length && !hasError) {
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Database error occurred');
                                    res.status(500).json({ error: 'Internal server error' });
                                    return;
                                }
                                res.status(200).json({ message: 'Product added successfully' });
                            });
                        }
                    });
                });
            });
        });

    } catch (error) {
        console.error('Unexpected error occurred');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).send('Not Found');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unexpected error occurred');
    res.status(500).send('Internal server error');
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
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