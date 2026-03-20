const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

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

// Create tables if they don't exist
function initializeDatabase() {
    db.serialize(() => {
        // Products table
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tags table
        db.run(`CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_name TEXT NOT NULL UNIQUE
        )`);

        // Product-Tag relationship table
        db.run(`CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER,
            tag_id INTEGER,
            PRIMARY KEY (product_id, tag_id),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )`);
    });
}

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

// Helper function to get or create tag
function getOrCreateTag(tagName, callback) {
    const normalizedTag = tagName.trim().toLowerCase();
    
    db.get('SELECT id FROM tags WHERE tag_name = ?', [normalizedTag], (err, row) => {
        if (err) {
            return callback(err, null);
        }
        
        if (row) {
            callback(null, row.id);
        } else {
            db.run('INSERT INTO tags (tag_name) VALUES (?)', [normalizedTag], function(err) {
                if (err) {
                    return callback(err, null);
                }
                callback(null, this.lastID);
            });
        }
    });
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
        return res.status(400).send('<html><body><h1>Error 400: Bad Request</h1><p>Tags parameter is required</p></body></html>');
    }

    // Parse and normalize tags
    const searchTags = tagsParam.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0);

    if (searchTags.length === 0) {
        return res.status(400).send('<html><body><h1>Error 400: Bad Request</h1><p>At least one valid tag is required</p></body></html>');
    }

    // Create placeholders for SQL IN clause
    const placeholders = searchTags.map(() => '?').join(',');
    
    const query = `
        SELECT DISTINCT p.id, p.product_name, p.created_at
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE t.tag_name IN (${placeholders})
        ORDER BY p.created_at DESC
    `;

    db.all(query, searchTags, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('<html><body><h1>Error 500: Internal Server Error</h1></body></html>');
        }

        // Generate HTML response
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .product { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .product-name { font-weight: bold; font-size: 18px; color: #333; }
        .product-date { color: #666; font-size: 14px; margin-top: 5px; }
        .search-info { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .no-results { text-align: center; color: #666; margin: 40px 0; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <div class="search-info">
        <strong>Searched tags:</strong> ${escapeHtml(searchTags.join(', '))}
    </div>
`;

        if (rows.length === 0) {
            html += '<div class="no-results"><h2>No products found</h2><p>No products match the provided tags.</p></div>';
        } else {
            html += `<h2>Found ${rows.length} product(s)</h2>`;
            
            rows.forEach(product => {
                html += `
    <div class="product">
        <div class="product-name">${escapeHtml(product.product_name)}</div>
        <div class="product-date">Added: ${new Date(product.created_at).toLocaleString()}</div>
    </div>`;
            });
        }

        html += `
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /recommender - Add new product with tags
app.post('/recommender', (req, res) => {
    const { product_name, tags } = req.body;

    // Validate input
    if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
        return res.status(400).json({ error: 'Product name is required and must be a non-empty string' });
    }

    if (!tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Tags are required and must be a non-empty array' });
    }

    // Validate tags
    const validTags = tags.filter(tag => 
        typeof tag === 'string' && tag.trim().length > 0
    );

    if (validTags.length === 0) {
        return res.status(400).json({ error: 'At least one valid tag is required' });
    }

    const trimmedProductName = product_name.trim();

    // Insert product
    db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedProductName], function(err) {
        if (err) {
            console.error('Error inserting product:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const productId = this.lastID;
        let processedTags = 0;
        let hasError = false;

        // Process each tag
        validTags.forEach(tag => {
            getOrCreateTag(tag, (err, tagId) => {
                if (err) {
                    console.error('Error processing tag:', err);
                    if (!hasError) {
                        hasError = true;
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    return;
                }

                // Link product to tag
                db.run('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                    [productId, tagId], (err) => {
                    if (err) {
                        console.error('Error linking product to tag:', err);
                        if (!hasError) {
                            hasError = true;
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        return;
                    }

                    processedTags++;
                    
                    // Check if all tags have been processed
                    if (processedTags === validTags.length && !hasError) {
                        res.status(200).json({ 
                            message: 'Product added successfully',
                            product_id: productId,
                            product_name: trimmedProductName,
                            tags: validTags
                        });
                    }
                });
            });
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});