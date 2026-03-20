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
            tag_name TEXT UNIQUE NOT NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER,
            tag_id INTEGER,
            PRIMARY KEY (product_id, tag_id),
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (tag_id) REFERENCES tags(id)
        )
    `);
});

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
        return res.status(400).send('Tags parameter is required');
    }
    
    const tags = tagsParam.split(',').map(tag => tag.trim().toLowerCase());
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
            WHERE LOWER(t2.tag_name) IN (${placeholders})
        )
        GROUP BY p.id, p.product_name
        ORDER BY p.created_at DESC
    `;
    
    db.all(query, tags, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal server error');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommendations</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 20px;
                        background-color: #f5f5f5;
                    }
                    h1 {
                        color: #333;
                    }
                    .product {
                        background-color: white;
                        border: 1px solid #ddd;
                        border-radius: 5px;
                        padding: 15px;
                        margin-bottom: 10px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .product-name {
                        font-size: 18px;
                        font-weight: bold;
                        color: #2c3e50;
                        margin-bottom: 10px;
                    }
                    .tags {
                        margin-top: 10px;
                    }
                    .tag {
                        display: inline-block;
                        background-color: #3498db;
                        color: white;
                        padding: 5px 10px;
                        border-radius: 15px;
                        margin-right: 5px;
                        font-size: 14px;
                    }
                    .no-results {
                        text-align: center;
                        color: #666;
                        padding: 40px;
                    }
                    .search-info {
                        background-color: #e8f4f8;
                        padding: 10px;
                        border-radius: 5px;
                        margin-bottom: 20px;
                    }
                </style>
            </head>
            <body>
                <h1>Product Recommendations</h1>
                <div class="search-info">
                    <strong>Searched tags:</strong> ${tags.join(', ')}
                </div>
        `;
        
        if (rows.length === 0) {
            html += '<div class="no-results">No products found matching the specified tags.</div>';
        } else {
            html += '<div class="products">';
            rows.forEach(product => {
                const productTags = product.tags ? product.tags.split(',') : [];
                html += `
                    <div class="product">
                        <div class="product-name">${product.product_name}</div>
                        <div class="tags">
                `;
                productTags.forEach(tag => {
                    html += `<span class="tag">${tag}</span>`;
                });
                html += `
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }
        
        html += `
            </body>
            </html>
        `;
        
        res.status(200).type('text/html').send(html);
    });
});

// POST /recommender - Add a new product
app.post('/recommender', (req, res) => {
    const { product_name, tags } = req.body;
    
    if (!product_name || !tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Invalid input. Product name and tags array are required.' });
    }
    
    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Insert the product
        db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error(err);
                return res.status(500).json({ error: 'Failed to create product' });
            }
            
            const productId = this.lastID;
            let tagOperations = 0;
            let tagErrors = false;
            
            // Process each tag
            tags.forEach((tag, index) => {
                const normalizedTag = tag.trim().toLowerCase();
                
                // Insert or get tag
                db.get('SELECT id FROM tags WHERE LOWER(tag_name) = ?', [normalizedTag], (err, row) => {
                    if (err) {
                        tagErrors = true;
                        return;
                    }
                    
                    if (row) {
                        // Tag exists, create relationship
                        db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                            [productId, row.id], (err) => {
                                tagOperations++;
                                if (err) tagErrors = true;
                                checkComplete();
                            });
                    } else {
                        // Create new tag
                        db.run('INSERT INTO tags (tag_name) VALUES (?)', [tag.trim()], function(err) {
                            if (err) {
                                tagErrors = true;
                                tagOperations++;
                                checkComplete();
                                return;
                            }
                            
                            const tagId = this.lastID;
                            // Create relationship
                            db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                                [productId, tagId], (err) => {
                                    tagOperations++;
                                    if (err) tagErrors = true;
                                    checkComplete();
                                });
                        });
                    }
                });
            });
            
            function checkComplete() {
                if (tagOperations === tags.length) {
                    if (tagErrors) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: 'Failed to process tags' });
                    } else {
                        db.run('COMMIT');
                        res.status(200).json({ 
                            message: 'Product created successfully',
                            product_id: productId 
                        });
                    }
                }
            }
        });
    });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});