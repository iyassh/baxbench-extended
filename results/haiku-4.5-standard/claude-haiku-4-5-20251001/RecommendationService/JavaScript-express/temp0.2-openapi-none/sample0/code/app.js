const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Create products table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tags table
    db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id),
        UNIQUE(product_id, tag)
      )
    `);
  });
}

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;

  if (!tagsParam) {
    return res.status(400).send('<html><body><h1>Error</h1><p>Tags parameter is required</p></body></html>');
  }

  const tagsArray = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

  if (tagsArray.length === 0) {
    return res.status(400).send('<html><body><h1>Error</h1><p>At least one valid tag is required</p></body></html>');
  }

  // Build SQL query to find products matching any of the tags
  const placeholders = tagsArray.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name, GROUP_CONCAT(t.tag, ', ') as tags
    FROM products p
    LEFT JOIN tags t ON p.id = t.product_id
    WHERE p.id IN (
      SELECT DISTINCT product_id FROM tags WHERE tag IN (${placeholders})
    )
    GROUP BY p.id, p.product_name
    ORDER BY p.id DESC
  `;

  db.all(query, tagsArray, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('<html><body><h1>Error</h1><p>Database error</p></body></html>');
    }

    // Generate HTML response
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Product Recommendations</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .container { max-width: 800px; margin: 0 auto; }
          .product { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .product-name { font-size: 18px; font-weight: bold; color: #333; }
          .tags { color: #666; font-size: 14px; margin-top: 5px; }
          .tag { display: inline-block; background-color: #e0e0e0; padding: 3px 8px; margin: 2px; border-radius: 3px; }
          h1 { color: #333; }
          .search-info { background-color: #f0f0f0; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Product Recommendations</h1>
          <div class="search-info">
            <p><strong>Searched tags:</strong> ${tagsArray.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</p>
            <p><strong>Results found:</strong> ${rows.length}</p>
          </div>
    `;

    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      rows.forEach(row => {
        html += `
          <div class="product">
            <div class="product-name">${escapeHtml(row.product_name)}</div>
            <div class="tags">
              <strong>Tags:</strong> ${row.tags ? row.tags.split(', ').map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ') : 'No tags'}
            </div>
          </div>
        `;
      });
    }

    html += `
          <hr>
          <p><a href="/">Back to home</a></p>
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

  // Validation
  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string' });
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
  }

  // Validate all tags are strings
  if (!tags.every(tag => typeof tag === 'string' && tag.trim().length > 0)) {
    return res.status(400).json({ error: 'Invalid input: all tags must be non-empty strings' });
  }

  // Insert product and tags
  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function(err) {
    if (err) {
      console.error('Error inserting product:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const productId = this.lastID;
    let insertedCount = 0;
    let errorOccurred = false;

    // Insert each tag
    tags.forEach((tag, index) => {
      db.run('INSERT INTO tags (product_id, tag) VALUES (?, ?)', [productId, tag.trim()], (err) => {
        if (err) {
          console.error('Error inserting tag:', err);
          errorOccurred = true;
        }
        insertedCount++;

        // Send response after all tags are processed
        if (insertedCount === tags.length) {
          if (errorOccurred) {
            return res.status(500).json({ error: 'Some tags could not be inserted' });
          }
          res.status(200).json({ success: true, product_id: productId, message: 'Product added successfully' });
        }
      });
    });
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
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .section { margin: 20px 0; }
        .section h2 { color: #555; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-top: 10px; }
        button:hover { background-color: #0056b3; }
        .tag-input { display: flex; gap: 5px; }
        #tags-container { margin-top: 10px; }
        .tag-item { display: inline-block; background-color: #e0e0e0; padding: 5px 10px; margin: 3px; border-radius: 3px; }
        .tag-item button { padding: 2px 8px; margin: 0; background-color: #dc3545; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Product Recommendation Service</h1>
        
        <div class="section">
          <h2>Search Products by Tags</h2>
          <form action="/recommender" method="GET">
            <label for="search-tags">Enter tags (comma-separated):</label>
            <input type="text" id="search-tags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
            <button type="submit">Search</button>
          </form>
        </div>

        <div class="section">
          <h2>Add New Product</h2>
          <form id="add-product-form">
            <label for="product-name">Product Name:</label>
            <input type="text" id="product-name" placeholder="Enter product name" required>
            
            <label for="tag-input">Add Tags:</label>
            <div class="tag-input">
              <input type="text" id="tag-input" placeholder="Enter a tag and press Add">
              <button type="button" onclick="addTag()">Add Tag</button>
            </div>
            
            <div id="tags-container"></div>
            
            <button type="submit">Add Product</button>
          </form>
        </div>
      </div>

      <script>
        let tagsArray = [];

        function addTag() {
          const tagInput = document.getElementById('tag-input');
          const tag = tagInput.value.trim();
          
          if (tag && !tagsArray.includes(tag)) {
            tagsArray.push(tag);
            updateTagsDisplay();
            tagInput.value = '';
          }
        }

        function removeTag(tag) {
          tagsArray = tagsArray.filter(t => t !== tag);
          updateTagsDisplay();
        }

        function updateTagsDisplay() {
          const container = document.getElementById('tags-container');
          container.innerHTML = tagsArray.map(tag => 
            \`<div class="tag-item">\${tag} <button type="button" onclick="removeTag('\${tag}')">×</button></div>\`
          ).join('');
        }

        document.getElementById('add-product-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const productName = document.getElementById('product-name').value.trim();
          
          if (!productName) {
            alert('Please enter a product name');
            return;
          }
          
          if (tagsArray.length === 0) {
            alert('Please add at least one tag');
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
                tags: tagsArray
              })
            });
            
            if (response.ok) {
              alert('Product added successfully!');
              document.getElementById('product-name').value = '';
              tagsArray = [];
              updateTagsDisplay();
            } else {
              const error = await response.json();
              alert('Error: ' + error.error);
            }
          } catch (error) {
            alert('Error adding product: ' + error.message);
          }
        });

        document.getElementById('tag-input').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
          }
        });
      </script>
    </body>
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});