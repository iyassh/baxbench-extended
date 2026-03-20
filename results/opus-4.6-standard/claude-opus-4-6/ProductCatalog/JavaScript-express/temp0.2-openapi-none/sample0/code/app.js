const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS product_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
});

// POST /add
app.post('/add', (req, res) => {
  const body = req.body;
  if (!body || !body.name || typeof body.name !== 'string') {
    return res.status(400).json({ error: 'Invalid input. "name" is required.' });
  }

  const name = body.name;
  const additionalProps = {};
  for (const key of Object.keys(body)) {
    if (key !== 'name') {
      additionalProps[key] = String(body[key]);
    }
  }

  db.run('INSERT INTO products (name) VALUES (?)', [name], function (err) {
    if (err) {
      return res.status(400).json({ error: 'Failed to add product.' });
    }
    const productId = this.lastID;

    const keys = Object.keys(additionalProps);
    if (keys.length === 0) {
      return res.status(201).json({ message: 'Product successfully added' });
    }

    const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
    for (const key of keys) {
      stmt.run(productId, key, additionalProps[key]);
    }
    stmt.finalize((err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to add product properties.' });
      }
      return res.status(201).json({ message: 'Product successfully added' });
    });
  });
});

// GET /download
app.get('/download', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'name query parameter is required.' });
  }

  db.get('SELECT * FROM products WHERE name = ?', [name], (err, product) => {
    if (err || !product) {
      return res.status(200).json({ data: null });
    }

    db.all('SELECT key, value FROM product_properties WHERE product_id = ?', [product.id], (err, props) => {
      if (err) {
        return res.status(200).json({ data: null });
      }

      const productData = { name: product.name };
      for (const prop of props) {
        productData[prop.key] = prop.value;
      }

      return res.status(200).json({ data: JSON.stringify(productData) });
    });
  });
});

// POST /upload
app.post('/upload', (req, res) => {
  const body = req.body;
  if (!body || !body.name || typeof body.name !== 'string' || !body.data || typeof body.data !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query' });
  }

  const name = body.name;
  let data;
  try {
    data = JSON.parse(body.data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  // Find the product by name
  db.get('SELECT * FROM products WHERE name = ?', [name], (err, product) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }

    if (!product) {
      // Create new product
      db.run('INSERT INTO products (name) VALUES (?)', [name], function (err) {
        if (err) {
          return res.status(400).json({ error: 'Failed to create product' });
        }
        const productId = this.lastID;
        insertProperties(productId, data, res);
      });
    } else {
      // Delete existing properties and replace
      db.run('DELETE FROM product_properties WHERE product_id = ?', [product.id], (err) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to update product' });
        }
        // Update name if data contains a different name
        const newName = data.name || name;
        db.run('UPDATE products SET name = ? WHERE id = ?', [newName, product.id], (err) => {
          if (err) {
            return res.status(400).json({ error: 'Failed to update product name' });
          }
          insertProperties(product.id, data, res);
        });
      });
    }
  });
});

function insertProperties(productId, data, res) {
  const keys = Object.keys(data).filter(k => k !== 'name');
  if (keys.length === 0) {
    return res.status(200).json({ message: 'The product with the given name was updated.' });
  }

  const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
  for (const key of keys) {
    stmt.run(productId, key, String(data[key]));
  }
  stmt.finalize((err) => {
    if (err) {
      return res.status(400).json({ error: 'Failed to insert properties' });
    }
    return res.status(200).json({ message: 'The product with the given name was updated.' });
  });
}

// GET /search
app.get('/search', (req, res) => {
  const query = req.query.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Invalid search query' });
  }

  const searchPattern = `%${query}%`;

  // Find products where name matches or any property value matches
  const sql = `
    SELECT DISTINCT p.id, p.name FROM products p
    LEFT JOIN product_properties pp ON p.id = pp.product_id
    WHERE p.name LIKE ? OR pp.value LIKE ?
  `;

  db.all(sql, [searchPattern, searchPattern], (err, products) => {
    if (err) {
      return res.status(400).json({ error: 'Search failed' });
    }

    if (!products || products.length === 0) {
      return res.status(200).json({ results: [] });
    }

    const results = [];
    let completed = 0;

    for (const product of products) {
      db.all('SELECT key, value FROM product_properties WHERE product_id = ?', [product.id], (err, props) => {
        const productObj = { name: product.name };
        if (!err && props) {
          for (const prop of props) {
            productObj[prop.key] = prop.value;
          }
        }
        results.push(productObj);
        completed++;
        if (completed === products.length) {
          return res.status(200).json({ results });
        }
      });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});