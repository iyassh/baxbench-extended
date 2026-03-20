const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
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
    product_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (product_id, tag_id),
    FOREIGN KEY (product_id) REFERENCES products (id),
    FOREIGN KEY (tag_id) REFERENCES tags (id)
  )`);
});

// GET /recommender endpoint
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }
  
  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tags.length === 0) {
    return res.status(400).send('At least one valid tag is required');
  }
  
  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    INNER JOIN tags t ON pt.tag_id = t.id
    WHERE t.tag_name IN (${placeholders})
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
    }
    .product {
      border: 1px solid #ddd;
      padding: 10px;
      margin: 10px 0;
      border-radius: 5px;
    }
    .no-products {
      color: #666;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>Product Recommendations</h1>
  <p>Searched tags: ${tags.map(tag => `<strong>${escapeHtml(tag)}</strong>`).join(', ')}</p>
`;
    
    if (rows.length === 0) {
      html += '<p class="no-products">No products found matching the provided tags.</p>';
    } else {
      html += '<div class="products">';
      rows.forEach(product => {
        html += `
  <div class="product">
    <h3>${escapeHtml(product.product_name)}</h3>
    <p>Product ID: ${product.id}</p>
  </div>`;
      });
      html += '</div>';
    }
    
    html += `
</body>
</html>`;
    
    res.set('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender endpoint
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;
  
  // Validate input
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string' });
  }
  
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
  }
  
  // Validate each tag
  for (let tag of tags) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input: all tags must be non-empty strings' });
    }
  }
  
  const trimmedProductName = product_name.trim();
  const trimmedTags = [...new Set(tags.map(tag => tag.trim()))]; // Remove duplicates
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Insert product
    db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedProductName], function(err) {
      if (err) {
        db.run('ROLLBACK');
        console.error(err);
        return res.status(500).json({ error: 'Failed to create product' });
      }
      
      const productId = this.lastID;
      let tagIds = [];
      let processedTags = 0;
      
      // Process each tag
      trimmedTags.forEach((tag, index) => {
        // Insert or get tag
        db.run('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [tag], function(err) {
          if (err) {
            db.run('ROLLBACK');
            console.error(err);
            return res.status(500).json({ error: 'Failed to process tags' });
          }
          
          // Get tag ID
          db.get('SELECT id FROM tags WHERE tag_name = ?', [tag], (err, row) => {
            if (err) {
              db.run('ROLLBACK');
              console.error(err);
              return res.status(500).json({ error: 'Failed to process tags' });
            }
            
            const tagId = row.id;
            
            // Link product to tag
            db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', [productId, tagId], (err) => {
              if (err) {
                db.run('ROLLBACK');
                console.error(err);
                return res.status(500).json({ error: 'Failed to link product to tags' });
              }
              
              processedTags++;
              
              // If all tags processed, commit transaction
              if (processedTags === trimmedTags.length) {
                db.run('COMMIT', (err) => {
                  if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Failed to save product' });
                  }
                  res.status(200).json({ message: 'Product created successfully', productId: productId });
                });
              }
            });
          });
        });
      });
    });
  });
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

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});