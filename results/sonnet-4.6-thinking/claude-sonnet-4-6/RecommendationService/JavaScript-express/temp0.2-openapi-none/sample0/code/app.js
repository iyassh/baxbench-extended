const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL
    )`, (err) => {
      if (err) console.error('Error creating products table:', err);
    });

    db.run(`CREATE TABLE IF NOT EXISTS product_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`, (err) => {
      if (err) console.error('Error creating product_tags table:', err);
    });
  }
});

// GET /recommender - Get products matching tags
app.get('/recommender', (req, res) => {
  const tagsParam = req.query.tags;
  
  if (!tagsParam) {
    return res.status(400).send('Tags parameter is required');
  }

  const tags = tagsParam.split(',').map(t => t.trim()).filter(t => t.length > 0);
  
  if (tags.length === 0) {
    return res.status(400).send('At least one tag is required');
  }

  const placeholders = tags.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT p.id, p.product_name
    FROM products p
    JOIN product_tags pt ON p.id = pt.product_id
    WHERE pt.tag IN (${placeholders})
  `;

  db.all(query, tags, (err, rows) => {
    if (err) {
      console.error('Error querying products:', err);
      return res.status(500).send('Internal server error');
    }

    let html = '<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>';
    html += '<h1>Recommended Products</h1>';
    
    if (rows.length === 0) {
      html += '<p>No products found for the given tags.</p>';
    } else {
      html += '<ul>';
      rows.forEach(row => {
        html += `<li><a href="/product/${row.id}">${row.product_name}</a></li>`;
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

  if (!product_name || !tags || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'Invalid input. product_name and tags array are required.' });
  }

  if (typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid product_name.' });
  }

  db.run('INSERT INTO products (product_name) VALUES (?)', [product_name.trim()], function(err) {
    if (err) {
      console.error('Error inserting product:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const productId = this.lastID;

    if (tags.length === 0) {
      return res.status(200).json({ message: 'Product created successfully', id: productId });
    }

    const tagInserts = tags.map(tag => new Promise((resolve, reject) => {
      db.run('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', [productId, tag], (err) => {
        if (err) reject(err);
        else resolve();
      });
    }));

    Promise.all(tagInserts)
      .then(() => {
        res.status(200).json({ message: 'Product created successfully', id: productId });
      })
      .catch(err => {
        console.error('Error inserting tags:', err);
        res.status(500).json({ error: 'Internal server error' });
      });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});