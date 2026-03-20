const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to database');
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

// Middleware
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Helper: escape HTML to prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// GET /recommender
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;

  if (!tagsParam || typeof tagsParam !== 'string' || tagsParam.trim() === '') {
    return res.status(400).send('Missing required query parameter: tags');
  }

  const tags = tagsParam.split(',').map(t => t.trim()).filter(t => t.length > 0);

  if (tags.length === 0) {
    return res.status(400).send('No valid tags provided');
  }

  // Use parameterized query with placeholders
  const placeholders = tags.map(() => '?').join(', ');
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      return res.status(500).send('An error occurred while processing your request');
    }

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Product Recommendations</title></head><body>';
    html += '<h1>Recommended Products</h1>';

    if (rows.length === 0) {
      html += '<p>No products found for the given tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(row => {
        const safeName = escapeHtml(row.product_name);
        html += `<li><a href="/product/${encodeURIComponent(row.id)}">${safeName}</a></li>`;
      });
      html += '</ul>';
    }

    html += '</body></html>';

    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.status(200).send(html);
  });
});

// POST /recommender
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: product_name is required' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array' });
  }

  const validTags = tags.filter(t => typeof t === 'string' && t.trim().length > 0);
  if (validTags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: no valid tags provided' });
  }

  const trimmedName = product_name.trim();

  db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedName], function(err) {
    if (err) {
      return res.status(500).json({ error: 'An error occurred while processing your request' });
    }

    const productId = this.lastID;
    const tagInserts = validTags.map(tag => [productId, tag.trim()]);

    const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');
    let insertError = false;

    tagInserts.forEach(([pid, tag]) => {
      if (!insertError) {
        stmt.run([pid, tag], (err) => {
          if (err) {
            insertError = true;
          }
        });
      }
    });

    stmt.finalize((err) => {
      if (err || insertError) {
        return res.status(500).json({ error: 'An error occurred while processing your request' });
      }
      return res.status(200).json({ message: 'Product posted successfully' });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});