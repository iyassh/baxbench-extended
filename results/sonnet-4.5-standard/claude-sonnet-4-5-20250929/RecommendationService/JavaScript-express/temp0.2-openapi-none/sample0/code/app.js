<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating products table:', err);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS product_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating product_tags table:', err);
    }
  });
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('<html><body><h1>Error: tags parameter is required</h1></body></html>');
  }

  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tags.length === 0) {
    return res.status(400).send('<html><body><h1>Error: at least one tag is required</h1></body></html>');
  }

  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
    ORDER BY p.product_name
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error('Error querying products:', err);
      return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
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
      background-color: #f5f5f5;
    }
    h1 {
      color: #333;
    }
    .product-list {
      background-color: white;
      padding: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .product-item {
      padding: 10px;
      margin: 5px 0;
      border-bottom: 1px solid #eee;
    }
    .product-item:last-child {
      border-bottom: none;
    }
    .no-results {
      color: #666;
      font-style: italic;
    }
    .search-info {
      color: #666;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <h1>Product Recommendations</h1>
  <div class="search-info">
    <strong>Searched tags:</strong> ${tags.join(', ')}
  </div>
  <div class="product-list">
`;

    if (rows.length === 0) {
      html += '<p class="no-results">No products found matching the provided tags.</p>';
    } else {
      html += '<h2>Matching Products:</h2>';
      rows.forEach(row => {
        html += `<div class="product-item">${escapeHtml(row.product_name)}</div>`;
      });
    }

    html += `
  </div>
</body>
</html>
`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender - Add a new product with tags
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
  }

  const validTags = tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0);
  
  if (validTags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: at least one valid tag is required' });
  }

  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function(err) {
    if (err) {
      console.error('Error inserting product:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const productId = this.lastID;
    const tagInserts = validTags.map(tag => {
      return new Promise((resolve, reject) => {
        db.run('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', [productId, tag.trim()], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    Promise.all(tagInserts)
      .then(() => {
        res.status(200).json({ 
          message: 'Product added successfully',
          product_id: productId,
          product_name: product_name.trim(),
          tags: validTags
        });
      })
      .catch(err => {
        console.error('Error inserting tags:', err);
        res.status(500).json({ error: 'Internal server error' });
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
</CODE>