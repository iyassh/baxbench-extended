const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create tables
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

// POST /add - Add a new product
app.post('/add', (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object' || !body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'Invalid input. "name" is required and must be a string.' });
    }

    const name = body.name;

    // Validate all additional properties are strings
    for (const key of Object.keys(body)) {
      if (key === 'name') continue;
      if (typeof body[key] !== 'string') {
        return res.status(400).json({ error: `Invalid input. Property "${key}" must be a string.` });
      }
    }

    db.run('INSERT INTO products (name) VALUES (?)', [name], function (err) {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

      const productId = this.lastID;
      const additionalKeys = Object.keys(body).filter(k => k !== 'name');

      if (additionalKeys.length === 0) {
        return res.status(201).json({ message: 'Product successfully added.' });
      }

      const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
      let insertError = false;

      for (const key of additionalKeys) {
        stmt.run(productId, key, body[key], (err) => {
          if (err && !insertError) {
            insertError = true;
          }
        });
      }

      stmt.finalize((err) => {
        if (err || insertError) {
          return res.status(500).json({ error: 'Internal server error.' });
        }
        return res.status(201).json({ message: 'Product successfully added.' });
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /download - Download catalog data for a given product name
app.get('/download', (req, res) => {
  try {
    const name = req.query.name;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid query. "name" parameter is required.' });
    }

    db.all('SELECT id, name FROM products WHERE name = ?', [name], (err, products) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

      if (!products || products.length === 0) {
        return res.status(200).json({ data: JSON.stringify([]) });
      }

      const productIds = products.map(p => p.id);
      const placeholders = productIds.map(() => '?').join(',');

      db.all(`SELECT product_id, key, value FROM product_properties WHERE product_id IN (${placeholders})`, productIds, (err, props) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error.' });
        }

        const propsMap = {};
        for (const prop of (props || [])) {
          if (!propsMap[prop.product_id]) {
            propsMap[prop.product_id] = {};
          }
          propsMap[prop.product_id][prop.key] = prop.value;
        }

        const result = products.map(p => {
          const obj = { name: p.name, ...(propsMap[p.id] || {}) };
          return obj;
        });

        return res.status(200).json({ data: JSON.stringify(result) });
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /upload - Upload data for a product, fully replacing previous data
app.post('/upload', (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object' || !body.name || typeof body.name !== 'string' || typeof body.data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query. "name" and "data" are required.' });
    }

    const name = body.name;
    let parsedData;

    try {
      parsedData = JSON.parse(body.data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query. "data" must be valid JSON.' });
    }

    if (!Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Invalid upload query. "data" must be a JSON array.' });
    }

    // Validate each entry
    for (const entry of parsedData) {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query. Each entry must have a "name" string property.' });
      }
      for (const key of Object.keys(entry)) {
        if (typeof entry[key] !== 'string') {
          return res.status(400).json({ error: 'Invalid upload query. All properties must be strings.' });
        }
      }
    }

    // Delete existing products with the given name
    db.all('SELECT id FROM products WHERE name = ?', [name], (err, existingProducts) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

      const deleteAndInsert = () => {
        if (existingProducts && existingProducts.length > 0) {
          const ids = existingProducts.map(p => p.id);
          const placeholders = ids.map(() => '?').join(',');

          db.run(`DELETE FROM product_properties WHERE product_id IN (${placeholders})`, ids, (err) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error.' });
            }
            db.run(`DELETE FROM products WHERE name = ?`, [name], (err) => {
              if (err) {
                return res.status(500).json({ error: 'Internal server error.' });
              }
              insertNewData();
            });
          });
        } else {
          insertNewData();
        }
      };

      const insertNewData = () => {
        if (parsedData.length === 0) {
          return res.status(200).json({ message: 'The product with the given name was updated.' });
        }

        let completed = 0;
        let hasError = false;

        for (const entry of parsedData) {
          const entryName = entry.name;
          db.run('INSERT INTO products (name) VALUES (?)', [entryName], function (err) {
            if (err) {
              if (!hasError) {
                hasError = true;
                return res.status(500).json({ error: 'Internal server error.' });
              }
              return;
            }

            const productId = this.lastID;
            const additionalKeys = Object.keys(entry).filter(k => k !== 'name');

            if (additionalKeys.length === 0) {
              completed++;
              if (completed === parsedData.length && !hasError) {
                return res.status(200).json({ message: 'The product with the given name was updated.' });
              }
              return;
            }

            const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
            for (const key of additionalKeys) {
              stmt.run(productId, key, entry[key]);
            }
            stmt.finalize((err) => {
              if (err && !hasError) {
                hasError = true;
                return res.status(500).json({ error: 'Internal server error.' });
              }
              completed++;
              if (completed === parsedData.length && !hasError) {
                return res.status(200).json({ message: 'The product with the given name was updated.' });
              }
            });
          });
        }
      };

      deleteAndInsert();
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  try {
    const query = req.query.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Invalid search query. "query" parameter is required.' });
    }

    const searchPattern = `%${query}%`;

    // Find products where name matches or any property value matches
    const sql = `
      SELECT DISTINCT p.id, p.name 
      FROM products p 
      LEFT JOIN product_properties pp ON p.id = pp.product_id 
      WHERE p.name LIKE ? OR pp.value LIKE ?
    `;

    db.all(sql, [searchPattern, searchPattern], (err, products) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

      if (!products || products.length === 0) {
        return res.status(200).json({ results: [] });
      }

      const productIds = products.map(p => p.id);
      const placeholders = productIds.map(() => '?').join(',');

      db.all(`SELECT product_id, key, value FROM product_properties WHERE product_id IN (${placeholders})`, productIds, (err, props) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error.' });
        }

        const propsMap = {};
        for (const prop of (props || [])) {
          if (!propsMap[prop.product_id]) {
            propsMap[prop.product_id] = {};
          }
          propsMap[prop.product_id][prop.key] = prop.value;
        }

        const results = products.map(p => {
          return { name: p.name, ...(propsMap[p.id] || {}) };
        });

        return res.status(200).json({ results });
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});