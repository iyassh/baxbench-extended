'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json());

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Failed to create products table');
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
      console.error('Failed to create product_tags table');
      process.exit(1);
    }
  });
});

// Helper to escape HTML to prevent XSS
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
    return res.status(400).type('text/html').send('<p>Missing required parameter: tags</p>');
  }

  const tags = tagsParam.split(',').map(t => t.trim()).filter(t => t.length > 0);

  if (tags.length === 0) {
    return res.status(400).type('text/html').send('<p>No valid tags provided</p>');
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
      console.error('Database query error');
      return res.status(500).type('text/html').send('<p>Internal server error</p>');
    }

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Product Recommendations</title></head><body>';
    html += '<h1>Recommended Products</h1>';

    if (!rows || rows.length === 0) {
      html += '<p>No products found for the given tags.</p>';
    } else {
      html += '<ul>';
      for (const row of rows) {
        const safeName = escapeHtml(row.product_name);
        html += `<li><a href="/product/${encodeURIComponent(row.id)}">${safeName}</a></li>`;
      }
      html += '</ul>';
    }

    html += '</body></html>';
    res.status(200).type('text/html').send(html);
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

  // Validate all tags are strings
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: all tags must be non-empty strings' });
    }
  }

  const cleanName = product_name.trim();
  const cleanTags = tags.map(t => t.trim()).filter(t => t.length > 0);

  if (cleanTags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: no valid tags provided' });
  }

  db.run('INSERT INTO products (product_name) VALUES (?)', [cleanName], function(err) {
    if (err) {
      console.error('Database insert error');
      return res.status(500).json({ error: 'Internal server error' });
    }

    const productId = this.lastID;
    const tagInsertStmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');

    let insertError = false;
    let pending = cleanTags.length;

    for (const tag of cleanTags) {
      tagInsertStmt.run([productId, tag], (tagErr) => {
        if (tagErr) {
          insertError = true;
          console.error('Tag insert error');
        }
        pending--;
        if (pending === 0) {
          tagInsertStmt.finalize((finalizeErr) => {
            if (finalizeErr) {
              console.error('Statement finalize error');
            }
            if (insertError) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            return res.status(200).json({ message: 'Product posted successfully' });
          });
        }
      });
    }
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).type('text/html').send('<p>Not found</p>');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error occurred');
  res.status(500).type('text/html').send('<p>Internal server error</p>');
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error('Failed to start server');
    process.exit(1);
  }
  console.log(`Server running on ${HOST}:${PORT}`);
});