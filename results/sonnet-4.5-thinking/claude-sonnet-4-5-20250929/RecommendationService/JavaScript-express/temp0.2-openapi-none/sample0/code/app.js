const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    // Create tables
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
      )`);
      
      db.run(`CREATE TABLE IF NOT EXISTS product_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        tag TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id)
      )`);
    });
  }
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
  return text.replace(/[&<>"']/g, m => map[m]);
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }
  
  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tags.length === 0) {
    // Return empty HTML if no valid tags
    let html = '<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>';
    html += '<h1>Product Recommendations</h1>';
    html += '<p>No products found matching the provided tags.</p>';
    html += '</body></html>';
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
  
  // Build query to find products that match at least one tag
  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name, GROUP_CONCAT(pt.tag) as tags
    FROM products p
    JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
    GROUP BY p.id, p.product_name
  `;
  
  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error('Error querying database:', err);
      return res.status(500).send('Database error');
    }
    
    // Generate HTML response
    let html = '<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>';
    html += '<h1>Product Recommendations</h1>';
    
    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(row => {
        html += `<li><a href="#">${escapeHtml(row.product_name)}</a> (Tags: ${escapeHtml(row.tags || '')})</li>`;
      });
      html += '</ul>';
    }
    
    html += '</body></html>';
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender - Add a new product
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;
  
  if (!product_name || !tags || !Array.isArray(tags)) {
    return res.status(400).send('Invalid input');
  }
  
  // Filter out empty tags
  const validTags = tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0);
  
  // Insert product
  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
    if (err) {
      console.error('Error inserting product:', err);
      return res.status(500).send('Database error');
    }
    
    const productId = this.lastID;
    
    // Insert tags if there are any
    if (validTags.length > 0) {
      const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');
      
      validTags.forEach(tag => {
        stmt.run(productId, tag.trim());
      });
      
      stmt.finalize((err) => {
        if (err) {
          console.error('Error inserting tags:', err);
          return res.status(500).send('Database error');
        }
        res.status(200).send('Product added successfully');
      });
    } else {
      res.status(200).send('Product added successfully');
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});