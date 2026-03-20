const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(DB_PATH);

// Initialize database
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

// Helper: get product with all properties
function getProductById(productId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, name FROM products WHERE id = ?', [productId], (err, product) => {
      if (err) return reject(err);
      if (!product) return resolve(null);
      db.all('SELECT key, value FROM product_properties WHERE product_id = ?', [productId], (err2, props) => {
        if (err2) return reject(err2);
        const result = { name: product.name };
        for (const prop of props) {
          result[prop.key] = prop.value;
        }
        resolve(result);
      });
    });
  });
}

// POST /add
app.post('/add', (req, res) => {
  const body = req.body;
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: name is required' });
  }

  const name = body.name.trim();

  // Collect additional properties (all must be strings)
  const additionalProps = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === 'name') continue;
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `Invalid input: property "${key}" must be a string` });
    }
    additionalProps.push({ key, value });
  }

  db.run('INSERT INTO products (name) VALUES (?)', [name], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    const productId = this.lastID;

    if (additionalProps.length === 0) {
      return res.status(201).json({ message: 'Product successfully added' });
    }

    const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
    for (const prop of additionalProps) {
      stmt.run(productId, prop.key, prop.value);
    }
    stmt.finalize((err2) => {
      if (err2) {
        return res.status(500).json({ error: 'Database error' });
      }
      return res.status(201).json({ message: 'Product successfully added' });
    });
  });
});

// GET /download
app.get('/download', (req, res) => {
  const name = req.query.name;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid query: name is required' });
  }

  db.get('SELECT id, name FROM products WHERE name = ?', [name.trim()], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!product) {
      return res.status(200).json({ data: JSON.stringify({}) });
    }

    db.all('SELECT key, value FROM product_properties WHERE product_id = ?', [product.id], (err2, props) => {
      if (err2) {
        return res.status(500).json({ error: 'Database error' });
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
  const { name, data } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid upload query: name is required' });
  }
  if (data === undefined || typeof data !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: data is required and must be a string' });
  }

  let parsedData;
  try {
    parsedData = JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
  }

  if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
    return res.status(400).json({ error: 'Invalid upload query: data must be a JSON object' });
  }

  const trimmedName = name.trim();

  // Collect additional properties from parsed data
  const additionalProps = [];
  for (const [key, value] of Object.entries(parsedData)) {
    if (key === 'name') continue;
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `Invalid upload query: property "${key}" must be a string` });
    }
    additionalProps.push({ key, value });
  }

  db.serialize(() => {
    // Find existing product
    db.get('SELECT id FROM products WHERE name = ?', [trimmedName], (err, product) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!product) {
        // Create new product
        db.run('INSERT INTO products (name) VALUES (?)', [trimmedName], function (err2) {
          if (err2) {
            return res.status(500).json({ error: 'Database error' });
          }
          const productId = this.lastID;
          insertProperties(productId, additionalProps, res);
        });
      } else {
        // Delete old properties and insert new ones
        db.run('DELETE FROM product_properties WHERE product_id = ?', [product.id], (err2) => {
          if (err2) {
            return res.status(500).json({ error: 'Database error' });
          }
          insertProperties(product.id, additionalProps, res);
        });
      }
    });
  });
});

function insertProperties(productId, props, res) {
  if (props.length === 0) {
    return res.status(200).json({ message: 'The product with the given name was updated.' });
  }
  const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
  for (const prop of props) {
    stmt.run(productId, prop.key, prop.value);
  }
  stmt.finalize((err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    return res.status(200).json({ message: 'The product with the given name was updated.' });
  });
}

// GET /search
app.get('/search', (req, res) => {
  const query = req.query.query;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Invalid search query' });
  }

  const searchTerm = `%${query.trim()}%`;

  // Find products where name matches or any property value matches
  const sql = `
    SELECT DISTINCT p.id, p.name FROM products p
    LEFT JOIN product_properties pp ON p.id = pp.product_id
    WHERE p.name LIKE ? OR pp.value LIKE ?
  `;

  db.all(sql, [searchTerm, searchTerm], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (products.length === 0) {
      return res.status(200).json({ results: [] });
    }

    const results = [];
    let completed = 0;

    for (const product of products) {
      db.all('SELECT key, value FROM product_properties WHERE product_id = ?', [product.id], (err2, props) => {
        if (err2) {
          // Skip on error
          completed++;
          if (completed === products.length) {
            return res.status(200).json({ results });
          }
          return;
        }

        const productObj = { name: product.name };
        for (const prop of props) {
          productObj[prop.key] = prop.value;
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
  console.log('Product Catalog server running on http://0.0.0.0:5000');
});