const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';

// Middleware
app.use(express.json());
app.set('view engine', 'html');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
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
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(product_id, tag)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating product_tags table:', err.message);
    }
  });
});

// Utility function to escape HTML
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
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

// Utility function to generate UUID
function generateId() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;

  if (!tagsParam || typeof tagsParam !== 'string') {
    return res.status(400).send('<html><body><h1>Error</h1><p>Tags parameter is required and must be a string.</p></body></html>');
  }

  const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

  if (tags.length === 0) {
    return res.status(400).send('<html><body><h1>Error</h1><p>At least one valid tag is required.</p></body></html>');
  }

  // Use parameterized queries to prevent SQL injection
  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name, GROUP_CONCAT(pt.tag, ', ') as tags
    FROM products p
    LEFT JOIN product_tags pt ON p.id = pt.product_id
    WHERE p.id IN (
      SELECT DISTINCT product_id FROM product_tags WHERE tag IN (${placeholders})
    )
    GROUP BY p.id, p.product_name
    ORDER BY p.created_at DESC
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred while processing your request.</p></body></html>');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Product Recommendations</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
          .product-name { font-weight: bold; font-size: 18px; }
          .tags { color: #666; font-size: 14px; }
          .search-info { background-color: #f0f0f0; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <h1>Product Recommendations</h1>
        <div class="search-info">
          <p>Search tags: <strong>${escapeHtml(tagsParam)}</strong></p>
          <p>Found ${rows.length} product(s)</p>
        </div>
    `;

    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      rows.forEach(row => {
        html += `
          <div class="product">
            <div class="product-name">${escapeHtml(row.product_name)}</div>
            <div class="tags">Tags: ${escapeHtml(row.tags || 'No tags')}</div>
          </div>
        `;
      });
    }

    html += `
        <hr>
        <a href="/">Back to home</a>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender - Add a new product
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  // Validate input
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid product_name. Must be a non-empty string.' });
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid tags. Must be a non-empty array.' });
  }

  // Validate all tags are strings
  if (!tags.every(tag => typeof tag === 'string' && tag.trim().length > 0)) {
    return res.status(400).json({ error: 'All tags must be non-empty strings.' });
  }

  const productId = generateId();
  const trimmedProductName = product_name.trim();
  const trimmedTags = tags.map(tag => tag.trim());

  // Insert product
  db.run(
    'INSERT INTO products (id, product_name) VALUES (?, ?)',
    [productId, trimmedProductName],
    function(err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Failed to create product.' });
      }

      // Insert tags
      let completed = 0;
      let hasError = false;

      trimmedTags.forEach(tag => {
        const tagId = generateId();
        db.run(
          'INSERT INTO product_tags (id, product_id, tag) VALUES (?, ?, ?)',
          [tagId, productId, tag],
          (err) => {
            completed++;
            if (err && !hasError) {
              hasError = true;
              console.error('Database error:', err.message);
              return res.status(500).json({ error: 'Failed to add tags.' });
            }

            if (completed === trimmedTags.length && !hasError) {
              res.status(200).json({ 
                message: 'Product created successfully.',
                product_id: productId
              });
            }
          }
        );
      });
    }
  );
});

// Root route
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Product Recommendation Service</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; max-width: 800px; }
        .section { margin: 30px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .response { margin-top: 20px; padding: 10px; background-color: #f0f0f0; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>Product Recommendation Service</h1>
      
      <div class="section">
        <h2>Search Products by Tags</h2>
        <form method="GET" action="/recommender">
          <label for="tags">Tags (comma-separated):</label><br>
          <input type="text" id="tags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
          <button type="submit">Search</button>
        </form>
      </div>

      <div class="section">
        <h2>Add New Product</h2>
        <form id="addProductForm">
          <label for="productName">Product Name:</label><br>
          <input type="text" id="productName" placeholder="e.g., Gaming Laptop" required>
          
          <label for="productTags">Tags (comma-separated):</label><br>
          <input type="text" id="productTags" placeholder="e.g., electronics, laptop, gaming" required>
          
          <button type="submit">Add Product</button>
        </form>
        <div id="response"></div>
      </div>

      <script>
        document.getElementById('addProductForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const productName = document.getElementById('productName').value;
          const tagsInput = document.getElementById('productTags').value;
          const tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

          if (tags.length === 0) {
            document.getElementById('response').innerHTML = '<p style="color: red;">Please enter at least one tag.</p>';
            return;
          }

          try {
            const response = await fetch('/recommender', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                product_name: productName,
                tags: tags
              })
            });

            const data = await response.json();
            if (response.ok) {
              document.getElementById('response').innerHTML = '<p style="color: green;">Product added successfully!</p>';
              document.getElementById('addProductForm').reset();
            } else {
              document.getElementById('response').innerHTML = '<p style="color: red;">Error: ' + (data.error || 'Unknown error') + '</p>';
            }
          } catch (error) {
            document.getElementById('response').innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
          }
        });
      </script>
    </body>
    </html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).send('<html><body><h1>Error</h1><p>An unexpected error occurred.</p></body></html>');
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('<html><body><h1>Not Found</h1><p>The requested resource was not found.</p></body></html>');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Product Recommendation Service running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});