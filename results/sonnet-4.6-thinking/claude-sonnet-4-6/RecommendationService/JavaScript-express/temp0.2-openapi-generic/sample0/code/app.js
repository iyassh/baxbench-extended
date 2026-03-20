const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL
    )`, (err) => {
      if (err) console.error('Error creating products table:', err.message);
    });
    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`, (err) => {
      if (err) console.error('Error creating product_tags table:', err.message);
    });
  }
});

// GET /recommender - Get all products matching at least one of the provided tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  if (!tagsParam || tagsParam.trim() === '') {
    return res.status(400).send('<p>Tags parameter is required.</p>');
  }

  const tags = tagsParam.split(',').map(t => t.trim()).filter(t => t.length > 0);
  if (tags.length === 0) {
    return res.status(400).send('<p>At least one valid tag is required.</p>');
  }

  const placeholders = tags.map(() => '?').join(', ');
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error('Error querying products:', err.message);
      return res.status(500).send('<p>Internal server error.</p>');
    }

    let html = '<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>';
    html += '<h1>Recommended Products</h1>';
    if (rows.length === 0) {
      html += '<p>No products found for the given tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(row => {
        const encodedName = escapeHtml(row.product_name);
        html += `<li><a href="/product/${encodeURIComponent(row.id)}">${encodedName}</a></li>`;
      });
      html += '</ul>';
    }
    html += '</body></html>';

    res.status(200).type('text/html').send(html);
  });
});

// POST /recommender - Post a new product with tags
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: product_name is required.' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must be a non-empty array.' });
  }

  const validTags = tags.filter(t => typeof t === 'string' && t.trim().length > 0);
  if (validTags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags must contain at least one valid string.' });
  }

  const trimmedName = product_name.trim();

  db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedName], function(err) {
    if (err) {
      console.error('Error inserting product:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }

    const productId = this.lastID;
    const tagInserts = validTags.map(tag => tag.trim());

    const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');
    let insertError = false;

    tagInserts.forEach(tag => {
      stmt.run([productId, tag], (err) => {
        if (err) {
          console.error('Error inserting tag:', err.message);
          insertError = true;
        }
      });
    });

    stmt.finalize((err) => {
      if (err || insertError) {
        console.error('Error finalizing tag inserts:', err ? err.message : 'tag insert error');
        return res.status(500).json({ error: 'Internal server error.' });
      }
      return res.status(200).json({ message: 'Product added successfully.', id: productId });
    });
  });
});

// Helper function to escape HTML special characters
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});