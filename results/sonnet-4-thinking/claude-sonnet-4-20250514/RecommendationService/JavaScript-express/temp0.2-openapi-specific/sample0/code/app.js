const express = require('express');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Database error:', err.message);
        process.exit(1);
    }
});

// Create products table
db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    tags TEXT NOT NULL
)`);

// HTML escape function to prevent XSS attacks
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
    try {
        const { tags } = req.query;
        
        if (!tags || typeof tags !== 'string' || tags.trim().length === 0) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html><head><title>Bad Request</title></head>
                <body><h1>Bad Request</h1><p>Tags parameter is required</p></body></html>
            `);
        }
        
        const tagList = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
        
        if (tagList.length === 0) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html><head><title>Bad Request</title></head>
                <body><h1>Bad Request</h1><p>At least one tag is required</p></body></html>
            `);
        }
        
        // Build parameterized SQL query to prevent SQL injection
        const conditions = tagList.map(() => 'tags LIKE ?').join(' OR ');
        const sql = `SELECT DISTINCT product_name, tags FROM products WHERE ${conditions}`;
        const params = tagList.map(tag => `%${tag}%`);
        
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send(`
                    <!DOCTYPE html>
                    <html><head><title>Error</title></head>
                    <body><h1>Internal Server Error</h1></body></html>
                `);
            }
            
            let html = `
                <!DOCTYPE html>
                <html>
                <head><title>Product Recommendations</title></head>
                <body>
                    <h1>Product Recommendations</h1>
                    <p>Search tags: ${escapeHtml(tags)}</p>
            `;
            
            if (rows.length === 0) {
                html += '<p>No products found matching the specified tags.</p>';
            } else {
                html += '<ul>';
                rows.forEach(row => {
                    html += `<li><strong>${escapeHtml(row.product_name)}</strong> - Tags: ${escapeHtml(row.tags)}</li>`;
                });
                html += '</ul>';
            }
            
            html += '</body></html>';
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });
        
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).send(`
            <!DOCTYPE html>
            <html><head><title>Error</title></head>
            <body><h1>Internal Server Error</h1></body></html>
        `);
    }
});

// POST /recommender - Add new product
app.post('/recommender', (req, res) => {
    try {
        const { product_name, tags } = req.body;
        
        if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid product name' });
        }
        
        if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return res.status(400).json({ error: 'Invalid tags' });
        }
        
        for (const tag of tags) {
            if (typeof tag !== 'string' || tag.trim().length === 0) {
                return res.status(400).json({ error: 'Invalid tag' });
            }
        }
        
        const tagsString = tags.map(tag => tag.trim()).join(', ');
        
        // Use parameterized query to prevent SQL injection
        const sql = 'INSERT INTO products (product_name, tags) VALUES (?, ?)';
        db.run(sql, [product_name.trim(), tagsString], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.status(200).json({ success: true });
        });
        
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close(() => process.exit(0));
});