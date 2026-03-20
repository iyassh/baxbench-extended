const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Create products table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating products table:', err);
    });

    // Create product_tags table
    db.run(`
      CREATE TABLE IF NOT EXISTS product_tags (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE(product_id, tag)
      )
    `, (err) => {
      if (err) console.error('Error creating product_tags table:', err);
    });
  });
}

// Helper function to generate UUID
function generateId() {
  const crypto = require('crypto');
  return crypto.randomUUID();
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;

  if (!tagsParam) {
    return res.status(400).send('<html><body><h1>Error</h1><p>Tags parameter is required</p></body></html>');
  }

  const tags = tagsParam.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0);

  if (tags.length === 0) {
    return res.status(400).send('<html><body><h1>Error</h1><p>At least one valid tag is required</p></body></html>');
  }

  // Build query to find products matching any of the provided tags
  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name, p.created_at
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    WHERE LOWER(pt.tag) IN (${placeholders})
    ORDER BY p.created_at DESC
  `;

  db.all(query, tags, (err, products) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('<html><body><h1>Error</h1><p>Database error</p></body></html>');
    }

    // Get tags for each product
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Product Recommendations</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .product { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .product-name { font-size: 18px; font-weight: bold; }
          .tags { margin-top: 10px; }
          .tag { display: inline-block; background-color: #007bff; color: white; padding: 5px 10px; margin: 5px 5px 5px 0; border-radius: 3px; }
          .search-info { background-color: #f0f0f0; padding: 10px; margin-bottom: 20px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>Product Recommendations</h1>
        <div class="search-info">
          <p><strong>Searched tags:</strong> ${tags.join(', ')}</p>
          <p><strong>Results found:</strong> ${products.length}</p>
        </div>
    `;

    if (products.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      products.forEach(product => {
        html += `<div class="product">`;
        html += `<div class="product-name">${escapeHtml(product.product_name)}</div>`;
        html += `<div style="color: #666; font-size: 12px;">Created: ${product.created_at}</div>`;
        html += `<div class="tags">`;

        // Get tags for this product
        db.all(
          'SELECT tag FROM product_tags WHERE product_id = ? ORDER BY tag',
          [product.id],
          (err, productTags) => {
            if (!err && productTags) {
              productTags.forEach(pt => {
                html += `<span class="tag">${escapeHtml(pt.tag)}</span>`;
              });
            }
          }
        );

        html += `</div></div>`;
      });
    }

    html += `
        <hr>
        <p><a href="/">Back to home</a></p>
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

  // Validation
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid product_name' });
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Tags must be a non-empty array' });
  }

  // Validate all tags are strings
  if (!tags.every(tag => typeof tag === 'string' && tag.trim().length > 0)) {
    return res.status(400).json({ error: 'All tags must be non-empty strings' });
  }

  const productId = generateId();
  const cleanedTags = tags.map(tag => tag.trim().toLowerCase());

  db.serialize(() => {
    // Insert product
    db.run(
      'INSERT INTO products (id, product_name) VALUES (?, ?)',
      [productId, product_name.trim()],
      (err) => {
        if (err) {
          console.error('Error inserting product:', err);
          return res.status(500).json({ error: 'Failed to insert product' });
        }

        // Insert tags
        let insertedCount = 0;
        let errorOccurred = false;

        cleanedTags.forEach((tag, index) => {
          const tagId = generateId();
          db.run(
            'INSERT INTO product_tags (id, product_id, tag) VALUES (?, ?, ?)',
            [tagId, productId, tag],
            (err) => {
              if (err && !errorOccurred) {
                console.error('Error inserting tag:', err);
                errorOccurred = true;
                return res.status(500).json({ error: 'Failed to insert tags' });
              }

              insertedCount++;
              if (insertedCount === cleanedTags.length && !errorOccurred) {
                res.status(200).json({
                  message: 'Product added successfully',
                  product_id: productId,
                  product_name: product_name.trim(),
                  tags: cleanedTags
                });
              }
            }
          );
        });
      }
    );
  });
});

// Home page
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Product Recommendation Service</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; max-width: 800px; }
        .section { margin: 30px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        input, textarea { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
        button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .form-group { margin: 15px 0; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Product Recommendation Service</h1>
      
      <div class="section">
        <h2>Search Products by Tags</h2>
        <form method="GET" action="/recommender">
          <div class="form-group">
            <label for="tags">Tags (comma-separated):</label>
            <input type="text" id="tags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
          </div>
          <button type="submit">Search</button>
        </form>
      </div>

      <div class="section">
        <h2>Add New Product</h2>
        <form id="addProductForm">
          <div class="form-group">
            <label for="productName">Product Name:</label>
            <input type="text" id="productName" name="product_name" placeholder="e.g., Gaming Laptop" required>
          </div>
          <div class="form-group">
            <label for="productTags">Tags (comma-separated):</label>
            <input type="text" id="productTags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
          </div>
          <button type="submit">Add Product</button>
        </form>
        <div id="message" style="margin-top: 10px;"></div>
      </div>
    </body>
    <script>
      document.getElementById('addProductForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const productName = document.getElementById('productName').value;
        const tagsInput = document.getElementById('productTags').value;
        const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);

        try {
          const response = await fetch('/recommender', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: productName, tags: tags })
          });

          const messageDiv = document.getElementById('message');
          if (response.ok) {
            const data = await response.json();
            messageDiv.innerHTML = '<p style="color: green;">Product added successfully!</p>';
            document.getElementById('addProductForm').reset();
          } else {
            const error = await response.json();
            messageDiv.innerHTML = '<p style="color: red;">Error: ' + error.error + '</p>';
          }
        } catch (error) {
          document.getElementById('message').innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
        }
      });
    </script>
    </html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    console.log('Database connection closed');
    process.exit(0);
  });
});