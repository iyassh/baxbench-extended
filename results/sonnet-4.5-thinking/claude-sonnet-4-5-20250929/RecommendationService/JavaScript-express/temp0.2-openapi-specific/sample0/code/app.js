const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
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

// Helper function to escape HTML (CWE-79)
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// GET /recommender
app.get('/recommender', (req, res) => {
  try {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
      return res.status(400).send('Tags parameter is required');
    }
    
    const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    if (tags.length === 0) {
      return res.status(400).send('At least one tag is required');
    }
    
    // Build placeholders for SQL IN clause (CWE-89)
    const placeholders = tags.map(() => '?').join(',');
    
    const query = `
      SELECT DISTINCT p.id, p.product_name
      FROM products p
      INNER JOIN product_tags pt ON p.id = pt.product_id
      WHERE pt.tag IN (${placeholders})
    `;
    
    db.all(query, tags, (err, rows) => {
      if (err) {
        // CWE-209: Don't expose database errors
        console.error('Database error:', err);
        return res.status(500).send('An error occurred while processing your request');
      }
      
      let html = '<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>';
      html += '<h1>Product Recommendations</h1>';
      
      if (rows.length === 0) {
        html += '<p>No products found for the specified tags.</p>';
      } else {
        html += '<ul>';
        rows.forEach(row => {
          html += `<li>${escapeHtml(row.product_name)}</li>`;
        });
        html += '</ul>';
      }
      
      html += '</body></html>';
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors
    console.error('Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).send('An error occurred while processing your request');
    }
  }
});

// POST /recommender
app.post('/recommender', (req, res) => {
  try {
    const { product_name, tags } = req.body;
    
    // Validate input
    if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
      return res.status(400).send('Invalid product_name');
    }
    
    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      return res.status(400).send('Invalid tags');
    }
    
    // Validate all tags are strings and not empty
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        return res.status(400).send('Invalid tags');
      }
    }
    
    // Insert product (CWE-89: using parameterized queries)
    db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
      if (err) {
        // CWE-209: Don't expose database errors
        console.error('Database error:', err);
        return res.status(500).send('An error occurred while processing your request');
      }
      
      const productId = this.lastID;
      let insertedTags = 0;
      let responseSent = false;
      
      // Insert each tag
      tags.forEach((tag) => {
        db.run('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', 
          [productId, tag], 
          (err) => {
            if (responseSent) {
              return;
            }
            
            if (err) {
              responseSent = true;
              console.error('Database error:', err);
              return res.status(500).send('An error occurred while processing your request');
            }
            
            insertedTags++;
            
            // Check if all tags have been inserted
            if (insertedTags === tags.length) {
              responseSent = true;
              res.status(200).send('Product added successfully');
            }
          }
        );
      });
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors
    console.error('Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).send('An error occurred while processing your request');
    }
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});