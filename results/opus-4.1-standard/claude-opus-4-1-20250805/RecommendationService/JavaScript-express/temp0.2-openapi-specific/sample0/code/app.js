const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';");
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating products table:', err.message);
            process.exit(1);
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_name TEXT NOT NULL UNIQUE
        )
    `, (err) => {
        if (err) {
            console.error('Error creating tags table:', err.message);
            process.exit(1);
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (product_id, tag_id),
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (tag_id) REFERENCES tags(id)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating product_tags table:', err.message);
            process.exit(1);
        }
    });
});

// HTML escape function to prevent XSS
function escapeHtml(text) {
    if (text == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    try {
        const tagsParam = req.query.tags;
        
        if (!tagsParam || typeof tagsParam !== 'string') {
            return res.status(400).send('Tags parameter is required');
        }

        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        
        if (tags.length === 0) {
            return res.status(400).send('At least one valid tag is required');
        }

        // Use parameterized query to prevent SQL injection
        const placeholders = tags.map(() => '?').join(',');
        const query = `
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            INNER JOIN product_tags pt ON p.id = pt.product_id
            INNER JOIN tags t ON pt.tag_id = t.id
            WHERE t.tag_name IN (${placeholders})
            ORDER BY p.created_at DESC
        `;

        db.all(query, tags, (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send('Internal server error');
            }

            // Generate HTML response with escaped content
            let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .product { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .product-name { font-weight: bold; }
        .no-products { color: #666; font-style: italic; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Searching for tags: ${escapeHtml(tags.join(', '))}</p>`;

            if (rows.length === 0) {
                html += '<p class="no-products">No products found matching the specified tags.</p>';
            } else {
                html += '<div class="products">';
                rows.forEach(row => {
                    html += `<div class="product">
                        <span class="product-name">${escapeHtml(row.product_name)}</span>
                    </div>`;
                });
                html += '</div>';
            }

            html += `
</body>
</html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// POST /recommender - Add a new product with tags
app.post('/recommender', (req, res) => {
    try {
        const { product_name, tags } = req.body;

        // Validate input
        if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid input: product_name is required' });
        }

        if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ error: 'Invalid input: tags array is required' });
        }

        // Validate each tag
        const validTags = tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0)
                              .map(tag => tag.trim());

        if (validTags.length === 0) {
            return res.status(400).json({ error: 'Invalid input: at least one valid tag is required' });
        }

        const cleanProductName = product_name.trim();

        // Start transaction
        db.serialize(() => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    console.error('Transaction error:', err.message);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                // Insert product
                db.run('INSERT INTO products (product_name) VALUES (?)', [cleanProductName], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error('Error inserting product:', err.message);
                        return res.status(500).json({ error: 'Internal server error' });
                    }

                    const productId = this.lastID;
                    let tagIds = [];
                    let errorOccurred = false;

                    // Process each tag
                    const processTag = (index) => {
                        if (errorOccurred || index >= validTags.length) {
                            if (!errorOccurred) {
                                // All tags processed, now create associations
                                let associationCount = 0;
                                tagIds.forEach(tagId => {
                                    db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                                        [productId, tagId], (err) => {
                                        if (err) {
                                            if (!errorOccurred) {
                                                errorOccurred = true;
                                                db.run('ROLLBACK');
                                                console.error('Error creating association:', err.message);
                                                return res.status(500).json({ error: 'Internal server error' });
                                            }
                                        } else {
                                            associationCount++;
                                            if (associationCount === tagIds.length) {
                                                // All associations created, commit transaction
                                                db.run('COMMIT', (err) => {
                                                    if (err) {
                                                        console.error('Commit error:', err.message);
                                                        return res.status(500).json({ error: 'Internal server error' });
                                                    }
                                                    res.status(200).json({ message: 'Product added successfully' });
                                                });
                                            }
                                        }
                                    });
                                });
                            }
                            return;
                        }

                        const tagName = validTags[index];
                        
                        // Check if tag exists
                        db.get('SELECT id FROM tags WHERE tag_name = ?', [tagName], (err, row) => {
                            if (err) {
                                errorOccurred = true;
                                db.run('ROLLBACK');
                                console.error('Error checking tag:', err.message);
                                return res.status(500).json({ error: 'Internal server error' });
                            }

                            if (row) {
                                tagIds.push(row.id);
                                processTag(index + 1);
                            } else {
                                // Insert new tag
                                db.run('INSERT INTO tags (tag_name) VALUES (?)', [tagName], function(err) {
                                    if (err) {
                                        errorOccurred = true;
                                        db.run('ROLLBACK');
                                        console.error('Error inserting tag:', err.message);
                                        return res.status(500).json({ error: 'Internal server error' });
                                    }
                                    tagIds.push(this.lastID);
                                    processTag(index + 1);
                                });
                            }
                        });
                    };

                    processTag(0);
                });
            });
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).send('Internal server error');
});

// Handle 404
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});