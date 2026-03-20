const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Create/connect to database
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT UNIQUE NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER,
        tag_id INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id),
        PRIMARY KEY (product_id, tag_id)
    )`);
});

// HTML escape function
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

// GET /recommender endpoint
app.get('/recommender', (req, res) => {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
        return res.status(400).send('<html><body><h1>Error: tags parameter is required</h1></body></html>');
    }
    
    const searchTags = tagsParam.split(',').map(tag => tag.trim());
    const placeholders = searchTags.map(() => '?').join(',');
    
    const query = `
        SELECT DISTINCT p.id, p.product_name, GROUP_CONCAT(t.tag_name) as tags
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE t.tag_name IN (${placeholders})
        GROUP BY p.id, p.product_name
    `;
    
    db.all(query, searchTags, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('<html><body><h1>Database error</h1></body></html>');
        }
        
        const escapedTags = searchTags.map(tag => escapeHtml(tag)).join(', ');
        
        let html = `
        <html>
        <head>
            <title>Product Recommendations</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .product { border: 1px solid #ccc; margin: 10px 0; padding: 10px; }
                .tags { color: #666; font-style: italic; }
                .product-link { text-decoration: none; color: #333; }
                .product-link:hover { background-color: #f0f0f0; }
            </style>
        </head>
        <body>
            <h1>Product Recommendations</h1>
            <p>Searched tags: ${escapedTags}</p>
        `;
        
        if (rows.length === 0) {
            html += '<p>No products found matching the specified tags.</p>';
        } else {
            rows.forEach(row => {
                const productName = escapeHtml(row.product_name);
                const productTags = escapeHtml(row.tags);
                
                html += `
                <div class="product">
                    <h3><a href="/product/${row.id}" class="product-link">${productName}</a></h3>
                    <div class="tags">Tags: ${productTags}</div>
                </div>
                `;
            });
        }
        
        html += '</body></html>';
        res.send(html);
    });
});

// Helper functions for async database operations
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function getQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// POST /recommender endpoint
app.post('/recommender', async (req, res) => {
    const { product_name, tags } = req.body;
    
    if (!product_name || !tags || !Array.isArray(tags)) {
        return res.status(400).json({ error: 'Invalid input: product_name and tags array are required' });
    }
    
    try {
        // Insert product
        const result = await runQuery('INSERT INTO products (product_name) VALUES (?)', [product_name]);
        const productId = result.lastID;
        
        // Process each tag
        for (const tagName of tags) {
            // Insert tag if it doesn't exist
            await runQuery('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [tagName]);
            
            // Get tag ID
            const tag = await getQuery('SELECT id FROM tags WHERE tag_name = ?', [tagName]);
            
            // Create association
            await runQuery('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                [productId, tag.id]);
        }
        
        res.status(200).json({ message: 'Product added successfully' });
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});