const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    // Create products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create tags table
    db.run(`CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT NOT NULL UNIQUE
    )`);

    // Create product_tags junction table
    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER,
        tag_id INTEGER,
        FOREIGN KEY (product_id) REFERENCES products (id),
        FOREIGN KEY (tag_id) REFERENCES tags (id),
        PRIMARY KEY (product_id, tag_id)
    )`);
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
        return res.status(400).send('<html><body><h1>Error: tags parameter is required</h1></body></html>');
    }

    const tags = tagsParam.split(',').map(tag => tag.trim().toLowerCase());
    
    // Create placeholders for the IN clause
    const placeholders = tags.map(() => '?').join(',');
    
    const query = `
        SELECT DISTINCT p.id, p.product_name, p.created_at
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE LOWER(t.tag_name) IN (${placeholders})
        ORDER BY p.created_at DESC
    `;

    db.all(query, tags, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
        }

        // Generate HTML response
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Product Recommendations</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .product { border: 1px solid #ccc; margin: 10px 0; padding: 15px; border-radius: 5px; }
                .product-name { font-weight: bold; font-size: 18px; color: #333; }
                .product-date { color: #666; font-size: 14px; }
                .no-products { text-align: center; color: #666; font-style: italic; }
                .search-info { background-color: #f0f0f0; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <h1>Product Recommendations</h1>
            <div class="search-info">
                <strong>Searched tags:</strong> ${tags.join(', ')}
            </div>
        `;

        if (rows.length === 0) {
            html += '<div class="no-products">No products found matching the specified tags.</div>';
        } else {
            rows.forEach(product => {
                html += `
                <div class="product">
                    <div class="product-name">${escapeHtml(product.product_name)}</div>
                    <div class="product-date">Added: ${new Date(product.created_at).toLocaleString()}</div>
                </div>
                `;
            });
        }

        html += `
        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /recommender - Add a new product with tags
app.post('/recommender', (req, res) => {
    const { product_name, tags } = req.body;

    // Validate input
    if (!product_name || !tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Invalid input: product_name and tags array are required' });
    }

    // Start transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Insert product
        db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
            if (err) {
                console.error('Error inserting product:', err);
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to insert product' });
            }

            const productId = this.lastID;
            let completedTags = 0;
            let hasError = false;

            // Process each tag
            tags.forEach(tagName => {
                const normalizedTag = tagName.trim().toLowerCase();
                
                // Insert tag if it doesn't exist
                db.run('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [normalizedTag], function(err) {
                    if (err && !hasError) {
                        console.error('Error inserting tag:', err);
                        hasError = true;
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Failed to insert tag' });
                    }

                    // Get tag ID
                    db.get('SELECT id FROM tags WHERE tag_name = ?', [normalizedTag], (err, row) => {
                        if (err && !hasError) {
                            console.error('Error getting tag ID:', err);
                            hasError = true;
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to get tag ID' });
                        }

                        // Link product to tag
                        db.run('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                               [productId, row.id], (err) => {
                            if (err && !hasError) {
                                console.error('Error linking product to tag:', err);
                                hasError = true;
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: 'Failed to link product to tag' });
                            }

                            completedTags++;
                            
                            // If all tags are processed successfully
                            if (completedTags === tags.length && !hasError) {
                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        console.error('Error committing transaction:', err);
                                        return res.status(500).json({ error: 'Failed to commit transaction' });
                                    }
                                    res.status(200).json({ 
                                        message: 'Product added successfully',
                                        product_id: productId 
                                    });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
});

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});