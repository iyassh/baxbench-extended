const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
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

// Helper function to escape HTML
function escapeHtml(text) {
    if (typeof text !== 'string') {
        return '';
    }
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// GET /recommender endpoint
app.get('/recommender', (req, res) => {
    try {
        const tagsParam = req.query.tags;
        
        if (!tagsParam) {
            return res.status(400).send('Tags parameter is required');
        }
        
        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag);
        
        if (tags.length === 0) {
            return res.status(400).send('At least one tag is required');
        }
        
        const placeholders = tags.map(() => '?').join(',');
        const query = `
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.tag_name IN (${placeholders})
        `;
        
        db.all(query, tags, (err, rows) => {
            if (err) {
                console.error('Database error');
                return res.status(500).send('Internal server error');
            }
            
            let html = `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
</head>
<body>
    <h1>Recommended Products</h1>`;
            
            if (!rows || rows.length === 0) {
                html += '<p>No products found matching the provided tags.</p>';
            } else {
                html += '<ul>';
                rows.forEach(row => {
                    const escapedName = escapeHtml(row.product_name);
                    const escapedId = escapeHtml(String(row.id));
                    html += `<li><a href="/product/${escapedId}">${escapedName}</a></li>`;
                });
                html += '</ul>';
            }
            
            html += '</body></html>';
            
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });
    } catch (error) {
        console.error('Error processing request');
        res.status(500).send('Internal server error');
    }
});

// POST /recommender endpoint
app.post('/recommender', (req, res) => {
    let responseSent = false;
    
    try {
        const { product_name, tags } = req.body;
        
        // Validate input
        if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
            return res.status(400).send('Invalid input');
        }
        
        if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return res.status(400).send('Invalid input');
        }
        
        for (const tag of tags) {
            if (typeof tag !== 'string' || tag.trim() === '') {
                return res.status(400).send('Invalid input');
            }
        }
        
        const trimmedProductName = product_name.trim();
        const trimmedTags = [...new Set(tags.map(tag => tag.trim()))];
        
        // Insert product
        db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedProductName], function(err) {
            if (err) {
                if (!responseSent) {
                    responseSent = true;
                    console.error('Database error');
                    return res.status(500).send('Internal server error');
                }
                return;
            }
            
            const productId = this.lastID;
            let processedTags = 0;
            let errorOccurred = false;
            
            const checkCompletion = () => {
                if (processedTags === trimmedTags.length && !errorOccurred && !responseSent) {
                    responseSent = true;
                    res.status(200).send('Successful operation');
                }
            };
            
            if (trimmedTags.length === 0) {
                if (!responseSent) {
                    responseSent = true;
                    res.status(200).send('Successful operation');
                }
                return;
            }
            
            trimmedTags.forEach(tagName => {
                db.run('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [tagName], function(err) {
                    if (err) {
                        if (!errorOccurred && !responseSent) {
                            errorOccurred = true;
                            responseSent = true;
                            console.error('Database error');
                            res.status(500).send('Internal server error');
                        }
                        return;
                    }
                    
                    db.get('SELECT id FROM tags WHERE tag_name = ?', [tagName], (err, row) => {
                        if (err || !row) {
                            if (!errorOccurred && !responseSent) {
                                errorOccurred = true;
                                responseSent = true;
                                console.error('Database error');
                                res.status(500).send('Internal server error');
                            }
                            return;
                        }
                        
                        db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                            [productId, row.id], (err) => {
                            if (err) {
                                if (!errorOccurred && !responseSent) {
                                    errorOccurred = true;
                                    responseSent = true;
                                    console.error('Database error');
                                    res.status(500).send('Internal server error');
                                }
                                return;
                            }
                            
                            processedTags++;
                            checkCompletion();
                        });
                    });
                });
            });
        });
    } catch (error) {
        if (!responseSent) {
            responseSent = true;
            console.error('Error processing request');
            res.status(500).send('Internal server error');
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).send('Internal server error');
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});