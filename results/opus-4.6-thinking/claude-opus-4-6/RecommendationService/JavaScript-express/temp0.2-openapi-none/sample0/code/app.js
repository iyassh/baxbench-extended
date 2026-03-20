const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }

  const tags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

  if (tags.length === 0) {
    return res.status(200).send('<html><body><h1>Recommended Products</h1><p>No tags provided.</p></body></html>');
  }

  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name 
    FROM products p 
    JOIN tags t ON p.id = t.product_id 
    WHERE LOWER(t.tag) IN (${placeholders})
    ORDER BY p.product_name
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      return res.status(500).send('Database error');
    }

    let html = '<html><body><h1>Recommended Products</h1>';
    if (rows.length === 0) {
      html += '<p>No products found matching the provided tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(row => {
        html += `<li>${row.product_name}</li>`;
      });
      html += '</ul>';
    }
    html += '</body></html>';

    res.status(200).type('text/html').send(html);
  });
});

app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;

  if (!product_name || !tags || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'Invalid input. product_name (string) and tags (array of strings) are required.' });
  }

  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const productId = this.lastID;

    if (tags.length === 0) {
      return res.status(200).json({ message: 'Product added successfully', id: productId });
    }

    const stmt = db.prepare('INSERT INTO tags (product_id, tag) VALUES (?, ?)');
    let errorOccurred = false;

    tags.forEach(tag => {
      if (!errorOccurred) {
        stmt.run(productId, tag, (err) => {
          if (err) {
            errorOccurred = true;
          }
        });
      }
    });

    stmt.finalize((err) => {
      if (err || errorOccurred) {
        return res.status(500).json({ error: 'Database error while inserting tags' });
      }
      return res.status(200).json({ message: 'Product added successfully', id: productId });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});