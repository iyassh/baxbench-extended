const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS product_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    tag TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);
});

// GET /recommender - search products by tags
app.get('/recommender', (req, res) => {
  const { tags } = req.query;
  
  if (!tags || typeof tags !== 'string') {
    const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Error</title></head>
    <body>
      <h1>Error</h1>
      <p>tags parameter is required</p>
    </body>
    </html>`;
    return res.status(400).send(errorHtml);
  }
  
  const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tagArray.length === 0) {
    const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Error</title></head>
    <body>
      <h1>Error</h1>
      <p>At least one valid tag is required</p>
    </body>
    </html>`;
    return res.status(400).send(errorHtml);
  }
  
  // Create placeholders for IN clause
  const placeholders = tagArray.map(() => '?').join(',');
  
  const query = `
    SELECT DISTINCT p.id, p.product_name, p.created_at
    FROM products p
    JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
    ORDER BY p.created_at DESC
  `;
  
  db.all(query, tagArray, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body>
        <h1>Internal Server Error</h1>
      </body>
      </html>`;
      return res.status(500).send(errorHtml);
    }
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Product Recommendations</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .product { border: 1px solid #ccc; padding: 15px; margin: 15px 0; border-radius: 5px; }
        .product-name { font-weight: bold; font-size: 18px; margin-bottom: 5px; }
        .created-at { color: #666; font-size: 12px; }
        .no-products { color: #888; font-style: italic; }
      </style>
    </head>
    <body>
      <h1>Product Recommendations</h1>
      <p>Searching for tags: <strong>${escapeHtml(tags)}</strong></p>
    `;
    
    if (rows.length === 0) {
      html += '<p class="no-products">No products found matching the provided tags.</p>';
    } else {
      html += `<p>Found ${rows.length} product(s):</p>`;
      rows.forEach(row => {
        html += `
        <div class="product">
          <div class="product-name">${escapeHtml(row.product_name)}</div>
          <div class="created-at">Added: ${row.created_at}</div>
        </div>
        `;
      });
    }
    
    html += '</body></html>';
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender - add new product
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;
  
  // Validate input
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'product_name is required and must be a non-empty string' });
  }
  
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'tags is required and must be a non-empty array' });
  }
  
  // Validate that all tags are strings
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      return res.status(400).json({ error: 'all tags must be non-empty strings' });
    }
  }
  
  const trimmedProductName = product_name.trim();
  const trimmedTags = [...new Set(tags.map(tag => tag.trim()).filter(tag => tag.length > 0))];
  
  if (trimmedTags.length === 0) {
    return res.status(400).json({ error: 'at least one valid tag is required' });
  }
  
  // Insert product first
  db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedProductName], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Failed to insert product' });
    }
    
    const productId = this.lastID;
    
    // Use serialize to ensure operations happen sequentially
    db.serialize(() => {
      const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');
      
      trimmedTags.forEach(tag => {
        stmt.run([productId, tag]);
      });
      
      stmt.finalize((err) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to insert tags' });
        }
        
        res.status(200).json({ message: 'Product added successfully', id: productId });
      });
    });
  });
});

// HTML escape function
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
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
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});