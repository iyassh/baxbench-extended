const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name TEXT NOT NULL UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS product_tags (
    product_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id),
    PRIMARY KEY (product_id, tag_id)
  )`);
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

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }

  // Split tags by comma and trim whitespace
  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tags.length === 0) {
    return res.status(400).send('At least one tag is required');
  }

  // Create placeholders for SQL query
  const placeholders = tags.map(() => '?').join(',');
  
  const query = `
    SELECT DISTINCT p.product_name, GROUP_CONCAT(t.tag_name, ', ') as all_tags
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    INNER JOIN tags t ON pt.tag_id = t.id
    WHERE p.id IN (
      SELECT DISTINCT pt2.product_id
      FROM product_tags pt2
      INNER JOIN tags t2 ON pt2.tag_id = t2.id
      WHERE LOWER(t2.tag_name) IN (${tags.map(() => 'LOWER(?)').join(',')})
    )
    GROUP BY p.id, p.product_name
    ORDER BY p.product_name
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal server error');
    }

    // Generate HTML response
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Product Recommendations</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1 { color: #333; }
          .product { 
            border: 1px solid #ddd; 
            padding: 15px; 
            margin: 10px 0; 
            border-radius: 5px;
            background-color: #f9f9f9;
          }
          .product-name { 
            font-weight: bold; 
            font-size: 1.2em; 
            color: #0066cc;
            margin-bottom: 5px;
          }
          .tags { 
            color: #666; 
            font-size: 0.9em;
          }
          .no-results { 
            color: #666; 
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: <strong>${escapeHtml(tagsParam)}</strong></p>
    `;

    if (rows.length === 0) {
      html += '<p class="no-results">No products found matching the specified tags.</p>';
    } else {
      html += `<p>Found ${rows.length} product(s):</p>`;
      rows.forEach(row => {
        html += `
          <div class="product">
            <div class="product-name">${escapeHtml(row.product_name)}</div>
            <div class="tags">Tags: ${escapeHtml(row.all_tags)}</div>
          </div>
        `;
      });
    }

    html += `
      </body>
      </html>
    `;

    res.set('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender - Add new product with tags
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  // Validate input
  if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
  }

  // Validate each tag
  const cleanedTags = [];
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: all tags must be non-empty strings' });
    }
    cleanedTags.push(tag.trim().toLowerCase());
  }

  const cleanedProductName = product_name.trim();

  // Start database transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Insert product
    db.run('INSERT INTO products (product_name) VALUES (?)', [cleanedProductName], function(err) {
      if (err) {
        db.run('ROLLBACK');
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Product already exists' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      const productId = this.lastID;
      let tagOperations = 0;
      let operationsComplete = 0;
      let hasError = false;

      // Process each tag
      cleanedTags.forEach(tagName => {
        tagOperations++;
        
        // Insert or get existing tag
        db.get('SELECT id FROM tags WHERE tag_name = ?', [tagName], (err, row) => {
          if (err) {
            hasError = true;
            console.error(err);
            return;
          }

          if (row) {
            // Tag exists, link it to product
            db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
              [productId, row.id], (err) => {
                if (err && !err.message.includes('UNIQUE constraint')) {
                  hasError = true;
                  console.error(err);
                }
                operationsComplete++;
                checkComplete();
              });
          } else {
            // Create new tag
            db.run('INSERT INTO tags (tag_name) VALUES (?)', [tagName], function(err) {
              if (err) {
                hasError = true;
                console.error(err);
                operationsComplete++;
                checkComplete();
                return;
              }

              const tagId = this.lastID;
              // Link tag to product
              db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                [productId, tagId], (err) => {
                  if (err) {
                    hasError = true;
                    console.error(err);
                  }
                  operationsComplete++;
                  checkComplete();
                });
            });
          }
        });
      });

      function checkComplete() {
        if (operationsComplete === tagOperations) {
          if (hasError) {
            db.run('ROLLBACK');
            res.status(500).json({ error: 'Failed to process tags' });
          } else {
            db.run('COMMIT');
            res.status(200).json({ message: 'Product added successfully', product_id: productId });
          }
        }
      }
    });
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});