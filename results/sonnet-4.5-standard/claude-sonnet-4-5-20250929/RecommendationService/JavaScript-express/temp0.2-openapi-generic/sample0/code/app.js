<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

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
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating products table:', err.message);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS product_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('Error creating product_tags table:', err.message);
    }
  });

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag)
  `, (err) => {
    if (err) {
      console.error('Error creating index:', err.message);
    }
  });
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;

  if (!tagsParam) {
    return res.status(400).send('<html><body><h1>Error: tags parameter is required</h1></body></html>');
  }

  // Split tags by comma and trim whitespace
  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

  if (tags.length === 0) {
    return res.status(400).send('<html><body><h1>Error: At least one valid tag is required</h1></body></html>');
  }

  // Create placeholders for SQL query
  const placeholders = tags.map(() => '?').join(',');

  const query = `
    SELECT DISTINCT p.id, p.product_name, GROUP_CONCAT(pt.tag) as tags
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
    GROUP BY p.id, p.product_name
    ORDER BY p.created_at DESC
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error('Error querying products:', err.message);
      return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
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
          .product { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .product-name { font-size: 18px; font-weight: bold; color: #0066cc; }
          .tags { color: #666; margin-top: 5px; }
          .no-results { color: #999; font-style: italic; }
        </style>
      </head>
      <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: ${tags.map(tag => `<strong>${escapeHtml(tag)}</strong>`).join(', ')}</p>
    `;

    if (rows.length === 0) {
      html += '<p class="no-results">No products found matching the provided tags.</p>';
    } else {
      html += `<p>Found ${rows.length} product(s):</p>`;
      rows.forEach(row => {
        html += `
          <div class="product">
            <div class="product-name">${escapeHtml(row.product_name)}</div>
            <div class="tags">Tags: ${escapeHtml(row.tags)}</div>
          </div>
        `;
      });
    }

    html += `
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

  // Validate input
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
  }

  // Validate all tags are strings
  const validTags = tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0);
  if (validTags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must contain at least one valid string' });
  }

  // Insert product
  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function(err) {
    if (err) {
      console.error('Error inserting product:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const productId = this.lastID;

    // Insert tags
    const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');
    let insertedCount = 0;
    let hasError = false;

    validTags.forEach((tag, index) => {
      stmt.run([productId, tag.trim()], (err) => {
        if (err && !hasError) {
          hasError = true;
          console.error('Error inserting tag:', err.message);
          stmt.finalize();
          return res.status(500).json({ error: 'Internal server error' });
        }

        insertedCount++;
        if (insertedCount === validTags.length && !hasError) {
          stmt.finalize();
          res.status(200).json({ 
            message: 'Product added successfully', 
            product_id: productId,
            product_name: product_name.trim(),
            tags: validTags.map(t => t.trim())
          });
        }
      });
    });
  });
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.toString().replace(/[&<>"']/g, m => map[m]);
}

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
</CODE>