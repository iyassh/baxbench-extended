const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';");
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT NOT NULL UNIQUE
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER,
        tag_id INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id),
        PRIMARY KEY (product_id, tag_id)
    )`);
});

// HTML escape function to prevent XSS
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// GET /recommender
app.get('/recommender', (req, res) => {
    try {
        const tagsParam = req.query.tags;
        
        if (!tagsParam) {
            return res.status(400).send('Tags parameter is required');
        }
        
        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        
        if (tags.length === 0) {
            return res.status(400).send('At least one valid tag is required');
        }
        
        // Create placeholders for parameterized query
        const placeholders = tags.map(() => '?').join(',');
        
        const query = `
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.tag_name IN (${placeholders})
            ORDER BY p.created_at DESC
        `;
        
        db.all(query, tags, (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send('Internal server error');
            }
            
            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Product Recommendations</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        h1 { color: #333; }
                        .product { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
                        .product-name { font-weight: bold; }
                        .no-results { color: #666; font-style: italic; }
                    </style>
                </head>
                <body>
                    <h1>Product Recommendations</h1>
                    <p>Searching for tags: ${escapeHtml(tags.join(', '))}</p>
            `;
            
            if (rows.length === 0) {
                html += '<p class="no-results">No products found matching the specified tags.</p>';
            } else {
                html += '<div class="products">';
                rows.forEach(row => {
                    html += `
                        <div class="product">
                            <span class="product-name">${escapeHtml(row.product_name)}</span>
                        </div>
                    `;
                });
                html += '</div>';
            }
            
            html += `
                </body>
                </html>
            `;
            
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// POST /recommender
app.post('/recommender', (req, res) => {
    try {
        const { product_name, tags } = req.body;
        
        // Validate input
        if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string' });
        }
        
        if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
        }
        
        // Validate each tag
        for (const tag of tags) {
            if (typeof tag !== 'string' || tag.trim().length === 0) {
                return res.status(400).json({ error: 'Invalid input: all tags must be non-empty strings' });
            }
        }
        
        const cleanProductName = product_name.trim();
        const cleanTags = tags.map(tag => tag.trim());
        
        // Start transaction
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Insert product
            db.run('INSERT INTO products (product_name) VALUES (?)', [cleanProductName], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error('Database error:', err.message);
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                const productId = this.lastID;
                let tagCount = 0;
                let errorOccurred = false;
                
                // Process each tag
                cleanTags.forEach((tag, index) => {
                    if (errorOccurred) return;
                    
                    // Insert or get tag
                    db.run('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [tag], function(tagErr) {
                        if (tagErr) {
                            errorOccurred = true;
                            db.run('ROLLBACK');
                            console.error('Database error:', tagErr.message);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        
                        // Get tag ID
                        db.get('SELECT id FROM tags WHERE tag_name = ?', [tag], (getErr, tagRow) => {
                            if (getErr || !tagRow) {
                                errorOccurred = true;
                                db.run('ROLLBACK');
                                console.error('Database error:', getErr ? getErr.message : 'Tag not found');
                                return res.status(500).json({ error: 'Internal server error' });
                            }
                            
                            // Link product and tag
                            db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                                [productId, tagRow.id], 
                                function(linkErr) {
                                    if (linkErr) {
                                        errorOccurred = true;
                                        db.run('ROLLBACK');
                                        console.error('Database error:', linkErr.message);
                                        return res.status(500).json({ error: 'Internal server error' });
                                    }
                                    
                                    tagCount++;
                                    
                                    // If all tags processed successfully, commit
                                    if (tagCount === cleanTags.length && !errorOccurred) {
                                        db.run('COMMIT', (commitErr) => {
                                            if (commitErr) {
                                                console.error('Database error:', commitErr.message);
                                                return res.status(500).json({ error: 'Internal server error' });
                                            }
                                            res.status(200).json({ message: 'Product created successfully' });
                                        });
                                    }
                                }
                            );
                        });
                    });
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

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});