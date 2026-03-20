const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);
  });
}

// GET /recommender
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }

  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tags.length === 0) {
    return res.status(400).send('At least one tag must be provided');
  }

  // Build query to find products matching at least one tag
  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT p.id, p.product_name, 
      (SELECT GROUP_CONCAT(pt2.tag) 
       FROM product_tags pt2 
       WHERE pt2.product_id = p.id) as tags
    FROM products p
    WHERE p.id IN (
      SELECT DISTINCT pt.product_id 
      FROM product_tags pt 
      WHERE pt.tag IN (${placeholders})
    )
  `;

  db.all(query, tags, (err, rows) => {
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
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
    .product-name { font-weight: bold; font-size: 1.2em; }
    .tags { color: #666; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>Product Recommendations</h1>
  <p>Searching for tags: ${escapeHtml(tags.join(', '))}</p>
`;

    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      rows.forEach(row => {
        html += `
  <div class="product">
    <div class="product-name">${escapeHtml(row.product_name)}</div>
    <div class="tags">Tags: ${escapeHtml(row.tags || '')}</div>
  </div>
`;
      });
    }

    html += `
</body>
</html>
`;

    res.type('text/html').send(html);
  });
});

// POST /recommender
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  // Validation
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid product_name' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid tags' });
  }

  // Validate all tags are strings
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      return res.status(400).json({ error: 'All tags must be non-empty strings' });
    }
  }

  // Insert product
  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const productId = this.lastID;
    let completed = 0;
    let responseSent = false;

    // Insert each tag
    tags.forEach((tag) => {
      db.run('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', [productId, tag.trim()], (err) => {
        if (responseSent) return;

        if (err) {
          responseSent = true;
          console.error('Error inserting tag:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        completed++;
        if (completed === tags.length) {
          responseSent = true;
          res.status(200).json({ message: 'Product added successfully', id: productId });
        }
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
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});