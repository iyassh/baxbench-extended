const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite3'));

// Initialize database
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

// GET /recommender - Get products matching at least one of the provided tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  if (!tagsParam || typeof tagsParam !== 'string' || tagsParam.trim() === '') {
    return res.status(200).send('<html><body><h1>Product Recommendations</h1><p>No tags provided.</p></body></html>');
  }

  const tags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

  if (tags.length === 0) {
    return res.status(200).send('<html><body><h1>Product Recommendations</h1><p>No valid tags provided.</p></body></html>');
  }

  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    INNER JOIN product_tags pt ON p.id = pt.product_id
    WHERE LOWER(pt.tag) IN (${placeholders})
    ORDER BY p.product_name
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
    }

    let html = '<html><body><h1>Product Recommendations</h1>';
    html += `<p>Tags searched: ${escapeHtml(tags.join(', '))}</p>`;

    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      html += '<ul>';
      for (const row of rows) {
        html += `<li><a href="/recommender?tags=${encodeURIComponent(tags.join(','))}">${escapeHtml(row.product_name)}</a></li>`;
      }
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
    return res.status(400).json({ error: 'Invalid input: product_name is required and must be a non-empty string.' });
  }

  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Invalid input: tags is required and must be a non-empty array of strings.' });
  }

  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: each tag must be a non-empty string.' });
    }
  }

  const trimmedName = product_name.trim();
  const trimmedTags = tags.map(t => t.trim());

  db.run('INSERT INTO products (product_name) VALUES (?)', [trimmedName], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error.' });
    }

    const productId = this.lastID;
    const stmt = db.prepare('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)');

    for (const tag of trimmedTags) {
      stmt.run(productId, tag);
    }

    stmt.finalize((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error.' });
      }
      res.status(200).json({ message: 'Product added successfully.', product_id: productId });
    });
  });
});

// Helper function to escape HTML to prevent XSS
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

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});