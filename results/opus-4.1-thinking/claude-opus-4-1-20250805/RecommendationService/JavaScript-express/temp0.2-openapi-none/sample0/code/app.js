const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  // Products table
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL UNIQUE
    )
  `);
  
  // Tags table
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_name TEXT NOT NULL UNIQUE
    )
  `);
  
  // Product-Tags junction table
  db.run(`
    CREATE TABLE IF NOT EXISTS product_tags (
      product_id INTEGER,
      tag_id INTEGER,
      FOREIGN KEY (product_id) REFERENCES products (id),
      FOREIGN KEY (tag_id) REFERENCES tags (id),
      PRIMARY KEY (product_id, tag_id)
    )
  `);
});

// GET /recommender - Get products by tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }
  
  // Split tags by comma and trim whitespace
  const tagsList = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  
  if (tagsList.length === 0) {
    return res.status(400).send('At least one tag is required');
  }
  
  // Create placeholders for SQL query
  const placeholders = tagsList.map(() => '?').join(',');
  
  // Query to get products that match at least one tag
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    JOIN product_tags pt ON p.id = pt.product_id
    JOIN tags t ON pt.tag_id = t.id
    WHERE t.tag_name IN (${placeholders})
    ORDER BY p.product_name
  `;
  
  db.all(query, tagsList, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
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
          ul { list-style-type: none; padding: 0; }
          li { 
            margin: 10px 0; 
            padding: 10px; 
            background-color: #f5f5f5;
            border-radius: 5px;
          }
          a { color: #007bff; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .no-results { color: #666; font-style: italic; }
        </style>
      </head>
      <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: ${tagsList.join(', ')}</p>
    `;
    
    if (rows.length === 0) {
      html += '<p class="no-results">No products found matching the provided tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(product => {
        html += `
          <li>
            <strong>${product.product_name}</strong> - 
            <a href="/product/${product.id}">View Details</a>
          </li>
        `;
      });
      html += '</ul>';
    }
    
    html += `
      </body>
      </html>
    `;
    
    res.send(html);
  });
});

// POST /recommender - Add a new product with tags
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;
  
  // Validate input
  if (!product_name || !tags || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'Invalid input. Product name and tags array are required.' });
  }
  
  if (product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Product name cannot be empty.' });
  }
  
  if (tags.length === 0) {
    return res.status(400).json({ error: 'At least one tag is required.' });
  }
  
  // Clean and validate tags
  const cleanTags = tags.map(tag => tag.trim()).filter(tag => tag.length > 0);
  if (cleanTags.length === 0) {
    return res.status(400).json({ error: 'At least one non-empty tag is required.' });
  }
  
  // Start database transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Insert product
    db.run(
      'INSERT INTO products (product_name) VALUES (?)',
      [product_name.trim()],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Product already exists.' });
          }
          console.error(err);
          return res.status(500).json({ error: 'Database error while inserting product.' });
        }
        
        const productId = this.lastID;
        let tagErrors = false;
        let tagsProcessed = 0;
        
        // Process each tag
        cleanTags.forEach((tag, index) => {
          if (tagErrors) return;
          
          // Check if tag exists, if not insert it
          db.get(
            'SELECT id FROM tags WHERE tag_name = ?',
            [tag],
            (err, row) => {
              if (err) {
                tagErrors = true;
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Database error while processing tags.' });
              }
              
              const processProductTag = (tagId) => {
                // Link product with tag
                db.run(
                  'INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                  [productId, tagId],
                  (err) => {
                    if (err) {
                      tagErrors = true;
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: 'Database error while linking product and tags.' });
                    }
                    
                    tagsProcessed++;
                    if (tagsProcessed === cleanTags.length && !tagErrors) {
                      // All tags processed successfully
                      db.run('COMMIT', (err) => {
                        if (err) {
                          return res.status(500).json({ error: 'Database error while committing transaction.' });
                        }
                        res.status(200).json({ message: 'Product added successfully', product_id: productId });
                      });
                    }
                  }
                );
              };
              
              if (row) {
                // Tag exists, use its ID
                processProductTag(row.id);
              } else {
                // Insert new tag
                db.run(
                  'INSERT INTO tags (tag_name) VALUES (?)',
                  [tag],
                  function(err) {
                    if (err) {
                      tagErrors = true;
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: 'Database error while inserting tag.' });
                    }
                    processProductTag(this.lastID);
                  }
                );
              }
            }
          );
        });
      }
    );
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});