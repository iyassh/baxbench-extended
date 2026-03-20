const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Middleware
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

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

// Helper function to escape HTML to prevent XSS (CWE-79)
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// GET /recommender - Get products matching at least one of the provided tags
app.get('/recommender', (req, res) => {
  try {
    const tagsParam = req.query.tags;

    if (!tagsParam || typeof tagsParam !== 'string' || tagsParam.trim() === '') {
      return res.status(400).send('<html><body><p>Tags parameter is required.</p></body></html>');
    }

    const tags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

    if (tags.length === 0) {
      return res.status(400).send('<html><body><p>At least one valid tag is required.</p></body></html>');
    }

    // Use parameterized queries to prevent SQL injection (CWE-89)
    const placeholders = tags.map(() => '?').join(',');
    const query = `
      SELECT DISTINCT p.id, p.product_name 
      FROM products p 
      INNER JOIN product_tags pt ON p.id = pt.product_id 
      WHERE LOWER(pt.tag) IN (${placeholders})
    `;

    db.all(query, tags, (err, rows) => {
      if (err) {
        // Don't expose internal error details (CWE-209)
        console.error('Database error:', err.message);
        return res.status(500).send('<html><body><p>An internal error occurred.</p></body></html>');
      }

      let html = '<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>';
      html += '<h1>Recommended Products</h1>';

      if (!rows || rows.length === 0) {
        html += '<p>No products found matching the provided tags.</p>';
      } else {
        html += '<ul>';
        for (const row of rows) {
          // Escape product name to prevent XSS (CWE-79)
          const safeName = escapeHtml(row.product_name);
          const safeId = escapeHtml(String(row.id));
          html += `<li>${safeName} (ID: ${safeId})</li>`;
        }
        html += '</ul>';
      }

      html += '</body></html>';
      res.status(200).type('text/html').send(html);
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    console.error('Unexpected error:', error.message);
    res.status(500).send('<html><body><p>An internal error occurred.</p></body></html>');
  }
});

// POST /recommender - Post a new product with tags
app.post('/recommender', (req, res) => {
  try {
    const { product_name, tags } = req.body;

    // Validate input (CWE-703)
    if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string.' });
    }

    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array of strings.' });
    }

    for (const tag of tags) {
      if (typeof tag !== 'string' || tag.trim() === '') {
        return res.status(400).json({ error: 'Invalid input: each tag must be a non-empty string.' });
      }
    }

    // Use parameterized queries to prevent SQL injection (CWE-89)
    db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function (err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'An internal error occurred.' });
      }

      const productId = this.lastID;
      const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');

      let insertError = false;
      let remaining = tags.length;

      for (const tag of tags) {
        stmt.run([productId, tag.trim().toLowerCase()], (err) => {
          if (err && !insertError) {
            insertError = true;
            console.error('Database error:', err.message);
            return res.status(500).json({ error: 'An internal error occurred.' });
          }
          remaining--;
          if (remaining === 0 && !insertError) {
            stmt.finalize();
            return res.status(200).json({ message: 'Product added successfully.', product_id: productId });
          }
        });
      }
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    console.error('Unexpected error:', error.message);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).send('An internal error occurred.');
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});