const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_name TEXT NOT NULL UNIQUE
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER,
            tag_id INTEGER,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (tag_id) REFERENCES tags(id),
            PRIMARY KEY (product_id, tag_id)
        )
    `);
});

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
        return res.status(400).send('Tags parameter is required');
    }
    
    // Split tags by comma and trim whitespace
    const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    if (tags.length === 0) {
        return res.status(400).send('At least one valid tag is required');
    }
    
    // Create placeholders for SQL query
    const placeholders = tags.map(() => '?').join(',');
    
    const query = `
        SELECT DISTINCT p.id, p.product_name, GROUP_CONCAT(t.tag_name) as tags
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE p.id IN (
            SELECT DISTINCT p2.id
            FROM products p2
            JOIN product_tags pt2 ON p2.id = pt2.product_id
            JOIN tags t2 ON pt2.tag_id = t2.id
            WHERE t2.tag_name IN (${placeholders})
        )
        GROUP BY p.id, p.product_name
        ORDER BY p.created_at DESC
    `;
    
    db.all(query, tags, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal server error');
        }
        
        // Generate HTML response
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommendations</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
                    .product-name { font-weight: bold; font-size: 18px; }
                    .tags { color: #666; margin-top: 5px; }
                    .no-results { color: #666; font-style: italic; }
                </style>
            </head>
            <body>
                <h1>Product Recommendations</h1>
                <p>Showing products matching tags: ${tags.map(t => `<strong>${escapeHtml(t)}</strong>`).join(', ')}</p>
        `;
        
        if (rows.length === 0) {
            html += '<p class="no-results">No products found matching the specified tags.</p>';
        } else {
            rows.forEach(product => {
                const productTags = product.tags ? product.tags.split(',') : [];
                html += `
                    <div class="product">
                        <div class="product-name">${escapeHtml(product.product_name)}</div>
                        <div class="tags">Tags: ${productTags.map(t => escapeHtml(t)).join(', ')}</div>
                    </div>
                `;
            });
        }
        
        html += `
            </body>
            </html>
        `;
        
        res.type('text/html').send(html);
    });
});

// POST /recommender - Add a new product
app.post('/recommender', (req, res) => {
    const { product_name, tags } = req.body;
    
    // Validate input
    if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid input: product_name is required' });
    }
    
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
    }
    
    // Validate each tag
    const validTags = tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0)
                          .map(tag => tag.trim());
    
    if (validTags.length === 0) {
        return res.status(400).json({ error: 'Invalid input: at least one valid tag is required' });
    }
    
    // Start transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Insert product
        db.run(
            'INSERT INTO products (product_name) VALUES (?)',
            [product_name.trim()],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error(err);
                    return res.status(500).json({ error: 'Failed to create product' });
                }
                
                const productId = this.lastID;
                let tagOperations = 0;
                let tagErrors = false;
                
                // Process each tag
                validTags.forEach((tagName, index) => {
                    // First, try to insert the tag (ignore if it already exists)
                    db.run(
                        'INSERT OR IGNORE INTO tags (tag_name) VALUES (?)',
                        [tagName],
                        function(err) {
                            if (err) {
                                tagErrors = true;
                                return;
                            }
                            
                            // Get the tag ID
                            db.get(
                                'SELECT id FROM tags WHERE tag_name = ?',
                                [tagName],
                                (err, tag) => {
                                    if (err || !tag) {
                                        tagErrors = true;
                                        return;
                                    }
                                    
                                    // Link product to tag
                                    db.run(
                                        'INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                                        [productId, tag.id],
                                        (err) => {
                                            if (err) {
                                                tagErrors = true;
                                            }
                                            
                                            tagOperations++;
                                            
                                            // Check if all tags have been processed
                                            if (tagOperations === validTags.length) {
                                                if (tagErrors) {
                                                    db.run('ROLLBACK');
                                                    return res.status(500).json({ error: 'Failed to process tags' });
                                                } else {
                                                    db.run('COMMIT');
                                                    return res.status(200).json({ message: 'Product created successfully', id: productId });
                                                }
                                            }
                                        }
                                    );
                                }
                            );
                        }
                    );
                });
            }
        );
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
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});