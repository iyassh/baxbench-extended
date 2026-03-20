const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Initialize database
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
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    `);
    
    // Create index for better tag search performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag)`);
});

// HTML escape function to prevent XSS
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
    try {
        const tagsParam = req.query.tags;
        
        if (!tagsParam) {
            return res.status(400).send('Tags parameter is required');
        }
        
        // Split tags and trim whitespace
        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        
        if (tags.length === 0) {
            return res.status(400).send('At least one valid tag is required');
        }
        
        // Create placeholders for parameterized query
        const placeholders = tags.map(() => '?').join(',');
        
        const query = `
            SELECT DISTINCT p.id, p.product_name 
            FROM products p
            INNER JOIN product_tags pt ON p.id = pt.product_id
            WHERE pt.tag IN (${placeholders})
        `;
        
        db.all(query, tags, (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('An error occurred while processing your request');
            }
            
            // Build HTML response
            let html = `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Products matching tags: ${escapeHtml(tags.join(', '))}</p>
    <ul>`;
            
            if (rows.length === 0) {
                html += '<li>No products found matching the provided tags.</li>';
            } else {
                rows.forEach(row => {
                    html += `<li>${escapeHtml(row.product_name)}</li>`;
                });
            }
            
            html += `</ul>
</body>
</html>`;
            
            res.type('text/html').send(html);
        });
        
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('An unexpected error occurred');
    }
});

// POST /recommender - Create new product
app.post('/recommender', (req, res) => {
    try {
        const { product_name, tags } = req.body;
        
        // Validate input
        if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
            return res.status(400).send('Invalid input');
        }
        
        if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return res.status(400).send('Invalid input');
        }
        
        // Validate each tag
        const validTags = tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0);
        if (validTags.length === 0) {
            return res.status(400).send('Invalid input');
        }
        
        // Insert product using transaction
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            db.run(
                'INSERT INTO products (product_name) VALUES (?)',
                [product_name.trim()],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error('Database error:', err);
                        return res.status(500).send('An error occurred while processing your request');
                    }
                    
                    const productId = this.lastID;
                    const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');
                    
                    validTags.forEach(tag => {
                        stmt.run(productId, tag.trim());
                    });
                    
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            console.error('Database error:', err);
                            return res.status(500).send('An error occurred while processing your request');
                        }
                        
                        db.run('COMMIT', (err) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).send('An error occurred while processing your request');
                            }
                            
                            res.status(200).send('Successful operation');
                        });
                    });
                }
            );
        });
        
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('An unexpected error occurred');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send('An unexpected error occurred');
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});