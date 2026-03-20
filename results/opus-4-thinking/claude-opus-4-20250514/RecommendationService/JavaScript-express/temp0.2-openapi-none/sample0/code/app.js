const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_name TEXT NOT NULL UNIQUE
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS product_tags (
      product_id INTEGER,
      tag_id INTEGER,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id),
      PRIMARY KEY (product_id, tag_id)
    )
  `);
});

// GET /recommender
app.get('/recommender', (req, res) => {
  const tags = req.query.tags;
  
  if (!tags) {
    return res.status(400).send('Tags parameter is required');
  }
  
  const tagArray = tags.split(',').map(tag => tag.trim());
  const placeholders = tagArray.map(() => '?').join(',');
  
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    JOIN product_tags pt ON p.id = pt.product_id
    JOIN tags t ON pt.tag_id = t.id
    WHERE t.tag_name IN (${placeholders})
  `;
  
  db.all(query, tagArray, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    
    let html = '<html><body><h1>Recommended Products</h1>';
    
    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(row => {
        html += `<li><a href="/product/${row.id}">${row.product_name}</a></li>`;
      });
      html += '</ul>';
    }
    
    html += '</body></html>';
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recommender
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;
  
  if (!product_name || !tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).send('Invalid input');
  }
  
  db.serialize(() => {
    // Insert product
    db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }
      
      const productId = this.lastID;
      let completed = 0;
      const totalTags = tags.length;
      let hasError = false;
      
      tags.forEach(tag => {
        // Insert or ignore tag
        db.run('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', [tag], (err) => {
          if (err) {
            console.error(err);
            hasError = true;
            if (!res.headersSent) {
              res.status(500).send('Database error');
            }
            return;
          }
          
          // Get tag id
          db.get('SELECT id FROM tags WHERE tag_name = ?', [tag], (err, row) => {
            if (err || !row) {
              console.error(err);
              hasError = true;
              if (!res.headersSent) {
                res.status(500).send('Database error');
              }
              return;
            }
            
            // Create product-tag relationship
            db.run('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
              [productId, row.id], 
              (err) => {
                if (err) {
                  console.error(err);
                  hasError = true;
                  if (!res.headersSent) {
                    res.status(500).send('Database error');
                  }
                  return;
                }
                
                completed++;
                if (completed === totalTags && !hasError && !res.headersSent) {
                  res.status(200).send('Successful operation');
                }
              }
            );
          });
        });
      });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});