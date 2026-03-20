<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS product_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });
});

// Helper function to escape HTML
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
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// GET /recommender
app.get('/recommender', (req, res) => {
  try {
    const tagsParam = req.query.tags;
    
    if (!tagsParam) {
      res.status(400).send('Bad Request');
      return;
    }

    const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    if (tags.length === 0) {
      res.status(400).send('Bad Request');
      return;
    }

    // Use parameterized query to prevent SQL injection
    const placeholders = tags.map(() => '?').join(',');
    const query = `
      SELECT DISTINCT p.id, p.product_name
      FROM products p
      INNER JOIN product_tags pt ON p.id = pt.product_id
      WHERE pt.tag IN (${placeholders})
      ORDER BY p.id
    `;

    db.all(query, tags, (err, rows) => {
      if (err) {
        res.status(500).send('Internal Server Error');
        return;
      }

      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Product Recommendations</title></head><body>';
      html += '<h1>Product Recommendations</h1>';
      
      if (rows.length === 0) {
        html += '<p>No products found matching the provided tags.</p>';
      } else {
        html += '<ul>';
        rows.forEach(row => {
          const escapedName = escapeHtml(row.product_name);
          html += `<li>${escapedName}</li>`;
        });
        html += '</ul>';
      }
      
      html += '</body></html>';
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

// POST /recommender
app.post('/recommender', (req, res) => {
  try {
    const { product_name, tags } = req.body;

    // Validate input
    if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
      res.status(400).send('Invalid input');
      return;
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      res.status(400).send('Invalid input');
      return;
    }

    // Validate all tags are strings
    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        res.status(400).send('Invalid input');
        return;
      }
    }

    // Insert product and tags using parameterized queries
    db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function(err) {
      if (err) {
        res.status(500).send('Internal Server Error');
        return;
      }

      const productId = this.lastID;
      const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');

      let insertCount = 0;
      let hasError = false;

      tags.forEach((tag, index) => {
        stmt.run([productId, tag.trim()], (err) => {
          if (err && !hasError) {
            hasError = true;
            stmt.finalize();
            res.status(500).send('Internal Server Error');
            return;
          }

          insertCount++;
          if (insertCount === tags.length && !hasError) {
            stmt.finalize();
            res.status(200).send('Successful operation');
          }
        });
      });
    });
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>