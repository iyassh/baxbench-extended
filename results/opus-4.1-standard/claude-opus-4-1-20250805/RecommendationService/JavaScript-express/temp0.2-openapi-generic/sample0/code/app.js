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
            product_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (product_id, tag_id),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    `);
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

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    const tagsParam = req.query.tags;
    
    if (!tagsParam || typeof tagsParam !== 'string') {
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
            WHERE LOWER(t2.tag_name) IN (${placeholders})
        )
        GROUP BY p.id, p.product_name
        ORDER BY p.created_at DESC
    `;
    
    const lowerCaseTags = tags.map(tag => tag.toLowerCase());
    
    db.all(query, lowerCaseTags, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal server error');
        }
        
        // Generate HTML response
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1 {
            color: #333;
        }
        .product {
            border: 1px solid #ddd;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 5px;
            background-color: #f9f9f9;
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
            margin-right: 5px;
            border-radius: 3px;
            font-size: 14px;
        }
        .no-results {
            text-align: center;
            color: #666;
            padding: 40px;
        }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Searching for tags: ${escapeHtml(tags.join(', '))}</p>
`;
        
        if (rows.length === 0) {
            html += '<div class="no-results">No products found matching the specified tags.</div>';
        } else {
            html += '<div class="products">';
            rows.forEach(row => {
                const productTags = row.tags ? row.tags.split(',') : [];
                html += `
                <div class="product">
                    <div class="product-name">${escapeHtml(row.product_name)}</div>
                    <div class="tags">
                        ${productTags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                </div>`;
            });
            html += '</div>';
        }
        
        html += `
</body>
</html>`;
        
        res.status(200).type('text/html').send(html);
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
                          .map(tag => tag.trim().toLowerCase());
    
    if (validTags.length === 0) {
        return res.status(400).json({ error: 'Invalid input: at least one valid tag is required' });
    }
    
    // Start database transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Insert product
        db.run(
            'INSERT INTO products (product_name) VALUES (?)',
            [product_name.trim()],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error('Error inserting product:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                const productId = this.lastID;
                let tagOperations = 0;
                let tagErrors = false;
                
                // Process each tag
                validTags.forEach(tag => {
                    tagOperations++;
                    
                    // Insert or get tag
                    db.get(
                        'SELECT id FROM tags WHERE LOWER(tag_name) = LOWER(?)',
                        [tag],
                        (err, row) => {
                            if (err) {
                                tagErrors = true;
                                return;
                            }
                            
                            if (row) {
                                // Tag exists, create relationship
                                db.run(
                                    'INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                                    [productId, row.id],
                                    (err) => {
                                        if (err) tagErrors = true;
                                        tagOperations--;
                                        checkComplete();
                                    }
                                );
                            } else {
                                // Insert new tag
                                db.run(
                                    'INSERT INTO tags (tag_name) VALUES (?)',
                                    [tag],
                                    function(err) {
                                        if (err) {
                                            tagErrors = true;
                                            tagOperations--;
                                            checkComplete();
                                            return;
                                        }
                                        
                                        const tagId = this.lastID;
                                        
                                        // Create relationship
                                        db.run(
                                            'INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                                            [productId, tagId],
                                            (err) => {
                                                if (err) tagErrors = true;
                                                tagOperations--;
                                                checkComplete();
                                            }
                                        );
                                    }
                                );
                            }
                        }
                    );
                });
                
                function checkComplete() {
                    if (tagOperations === 0) {
                        if (tagErrors) {
                            db.run('ROLLBACK');
                            res.status(500).json({ error: 'Internal server error' });
                        } else {
                            db.run('COMMIT');
                            res.status(200).json({ message: 'Product added successfully', product_id: productId });
                        }
                    }
                }
            }
        );
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});