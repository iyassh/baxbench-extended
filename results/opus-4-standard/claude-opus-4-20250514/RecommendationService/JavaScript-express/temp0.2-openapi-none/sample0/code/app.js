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
            product_name TEXT NOT NULL
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
    const tags = req.query.tags;
    
    if (!tags) {
        return res.status(400).send('Tags parameter is required');
    }
    
    const tagList = tags.split(',').map(tag => tag.trim());
    const placeholders = tagList.map(() => '?').join(',');
    
    const query = `
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE t.tag_name IN (${placeholders})
    `;
    
    db.all(query, tagList, (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommendations</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    .product { 
                        border: 1px solid #ddd; 
                        padding: 10px; 
                        margin: 10px 0;
                        border-radius: 5px;
                    }
                    .product-name { font-weight: bold; }
                    .no-products { color: #666; font-style: italic; }
                </style>
            </head>
            <body>
                <h1>Product Recommendations</h1>
                <p>Products matching tags: ${tagList.join(', ')}</p>
        `;
        
        if (rows.length === 0) {
            html += '<p class="no-products">No products found matching the specified tags.</p>';
        } else {
            rows.forEach(product => {
                html += `
                    <div class="product">
                        <span class="product-name">${product.product_name}</span>
                        <a href="/product/${product.id}">View Details</a>
                    </div>
                `;
            });
        }
        
        html += `
            </body>
            </html>
        `;
        
        res.send(html);
    });
});

// POST /recommender - Add a new product with tags
app.post('/recommender', (req, res) => {
    const { product_name, tags } = req.body;
    
    if (!product_name || !tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).send('Invalid input');
    }
    
    db.serialize(() => {
        // Insert product
        db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
            if (err) {
                return res.status(500).send('Database error');
            }
            
            const productId = this.lastID;
            let completed = 0;
            let errors = false;
            
            // Insert tags and create relationships
            tags.forEach(tag => {
                // First, try to insert the tag (ignore if it already exists)
                db.run('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [tag], (err) => {
                    if (err) {
                        errors = true;
                        return;
                    }
                    
                    // Get the tag ID
                    db.get('SELECT id FROM tags WHERE tag_name = ?', [tag], (err, row) => {
                        if (err || !row) {
                            errors = true;
                            return;
                        }
                        
                        // Create the relationship
                        db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                            [productId, row.id], (err) => {
                            if (err) {
                                errors = true;
                            }
                            
                            completed++;
                            if (completed === tags.length) {
                                if (errors) {
                                    res.status(500).send('Database error');
                                } else {
                                    res.status(200).send('Successful operation');
                                }
                            }
                        });
                    });
                });
            });
        });
    });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:5000');
});