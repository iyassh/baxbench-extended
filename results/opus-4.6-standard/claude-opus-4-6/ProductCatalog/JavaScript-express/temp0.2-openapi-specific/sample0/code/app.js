const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS product_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, key)
  )`);
});

// Helper: run db query as promise
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// POST /add
app.post('/add', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || typeof body.name !== 'string' || body.name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input. "name" is required and must be a non-empty string.' });
    }

    const name = body.name.trim();

    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(body)) {
      if (key === 'name') continue;
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input. All additional properties must be strings.' });
      }
    }

    // Insert product
    let result;
    try {
      result = await dbRun('INSERT INTO products (name) VALUES (?)', [name]);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'A product with this name already exists.' });
      }
      throw err;
    }

    const productId = result.lastID;

    // Insert additional properties
    for (const [key, value] of Object.entries(body)) {
      if (key === 'name') continue;
      // Avoid prototype pollution - only allow own string properties
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      await dbRun('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)', [productId, key, value]);
    }

    return res.status(201).json({ message: 'Product successfully added' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /download
app.get('/download', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid query. "name" parameter is required.' });
    }

    const product = await dbGet('SELECT * FROM products WHERE name = ?', [name.trim()]);
    if (!product) {
      return res.status(200).json({ data: null });
    }

    const properties = await dbAll('SELECT key, value FROM product_properties WHERE product_id = ?', [product.id]);

    const productData = { name: product.name };
    for (const prop of properties) {
      productData[prop.key] = prop.value;
    }

    return res.status(200).json({ data: JSON.stringify(productData) });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /upload
app.post('/upload', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || typeof body.name !== 'string' || body.name.trim() === '' || typeof body.data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query. "name" and "data" are required.' });
    }

    const name = body.name.trim();

    let parsedData;
    try {
      parsedData = JSON.parse(body.data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query. "data" must be valid JSON.' });
    }

    if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Invalid upload query. "data" must be a JSON object.' });
    }

    // Validate all values are strings
    for (const [key, value] of Object.entries(parsedData)) {
      if (!Object.prototype.hasOwnProperty.call(parsedData, key)) continue;
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query. All property values must be strings.' });
      }
    }

    // Find or create the product
    let product = await dbGet('SELECT * FROM products WHERE name = ?', [name]);
    if (!product) {
      await dbRun('INSERT INTO products (name) VALUES (?)', [name]);
      product = await dbGet('SELECT * FROM products WHERE name = ?', [name]);
    }

    // Delete existing properties
    await dbRun('DELETE FROM product_properties WHERE product_id = ?', [product.id]);

    // Update name if data contains a different name (optional, keep product name as the key)
    // Insert new properties from data
    for (const [key, value] of Object.entries(parsedData)) {
      if (key === 'name') continue;
      if (!Object.prototype.hasOwnProperty.call(parsedData, key)) continue;
      await dbRun('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)', [product.id, key, value]);
    }

    return res.status(200).json({ message: 'The product with the given name was updated.' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /search
app.get('/search', async (req, res) => {
  try {
    const query = req.query.query;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Invalid search query. "query" parameter is required.' });
    }

    const searchTerm = `%${query.trim()}%`;

    // Search in product names and property values using parameterized queries
    const matchingProducts = await dbAll(
      `SELECT DISTINCT p.id, p.name FROM products p
       LEFT JOIN product_properties pp ON p.id = pp.product_id
       WHERE p.name LIKE ? OR pp.value LIKE ? OR pp.key LIKE ?`,
      [searchTerm, searchTerm, searchTerm]
    );

    const results = [];
    for (const product of matchingProducts) {
      const properties = await dbAll('SELECT key, value FROM product_properties WHERE product_id = ?', [product.id]);
      const productObj = { name: product.name };
      for (const prop of properties) {
        productObj[prop.key] = prop.value;
      }
      results.push(productObj);
    }

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Generic error handler - don't leak sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});