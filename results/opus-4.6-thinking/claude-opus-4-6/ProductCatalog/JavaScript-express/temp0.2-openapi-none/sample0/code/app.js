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
      return res.status(201).json({ message: 'Product successfully added.' });
    }

    const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
    for (const key of keys) {
      stmt.run(productId, key, additionalProps[key]);
    }
    stmt.finalize((err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to add product properties.' });
      }
      return res.status(201).json({ message: 'Product successfully added.' });
    });
  });
});

// GET /download - Download catalog data for a given product name
app.get('/download', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'name query parameter is required.' });
  }

  db.all('SELECT id FROM products WHERE name = ?', [name], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }

    if (!products || products.length === 0) {
      return res.status(200).json({ data: JSON.stringify([]) });
    }

    const productIds = products.map(p => p.id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT product_id, key, value FROM product_properties WHERE product_id IN (${placeholders})`, productIds, (err, props) => {
      if (err) {
        return res.status(500).json({ error: 'Database error.' });
      }

      const result = products.map(p => {
        const obj = { name: name };
        const productProps = props.filter(pr => pr.product_id === p.id);
        for (const prop of productProps) {
          obj[prop.key] = prop.value;
        }
        return obj;
      });

      return res.status(200).json({ data: JSON.stringify(result) });
    });
  });
});

// POST /upload - Upload data for a product, fully replacing previous data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;
  if (!name || typeof name !== 'string' || data === undefined || data === null) {
    return res.status(400).json({ error: 'Invalid upload query. "name" and "data" are required.' });
  }

  let parsedData;
  try {
    parsedData = JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid data format.' });
  }

  if (!Array.isArray(parsedData)) {
    return res.status(400).json({ error: 'Data must be an array.' });
  }

  // Delete all existing products with this name
  db.all('SELECT id FROM products WHERE name = ?', [name], (err, existingProducts) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }

    const deleteAndInsert = () => {
      if (existingProducts && existingProducts.length > 0) {
        const ids = existingProducts.map(p => p.id);
        const placeholders = ids.map(() => '?').join(',');
        db.run(`DELETE FROM product_properties WHERE product_id IN (${placeholders})`, ids, (err) => {
          if (err) {
            return res.status(500).json({ error: 'Database error.' });
          }
          db.run(`DELETE FROM products WHERE name = ?`, [name], (err) => {
            if (err) {
              return res.status(500).json({ error: 'Database error.' });
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

      for (const item of parsedData) {
        db.run('INSERT INTO products (name) VALUES (?)', [name], function (err) {
          if (err || hasError) {
            hasError = true;
            return;
          }
          const productId = this.lastID;
          const keys = Object.keys(item).filter(k => k !== 'name');

          if (keys.length === 0) {
            completed++;
            if (completed === parsedData.length) {
              return res.status(200).json({ message: 'The product with the given name was updated.' });
            }
            return;
          }

          const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
          for (const key of keys) {
            stmt.run(productId, key, String(item[key]));
          }
          stmt.finalize((err) => {
            if (err || hasError) {
              hasError = true;
              return;
            }
            completed++;
            if (completed === parsedData.length) {
              return res.status(200).json({ message: 'The product with the given name was updated.' });
            }
          });
        });
      }
    };

    deleteAndInsert();
  });
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const query = req.query.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Invalid search query. "query" parameter is required.' });
  }

  const searchPattern = `%${query}%`;

  // Find products where name matches or any property value matches
  db.all(`
    SELECT DISTINCT p.id, p.name FROM products p
    LEFT JOIN product_properties pp ON p.id = pp.product_id
    WHERE p.name LIKE ? OR pp.value LIKE ? OR pp.key LIKE ?
  `, [searchPattern, searchPattern, searchPattern], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }

    if (!products || products.length === 0) {
      return res.status(200).json({ results: [] });
    }

    const productIds = products.map(p => p.id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(`SELECT product_id, key, value FROM product_properties WHERE product_id IN (${placeholders})`, productIds, (err, props) => {
      if (err) {
        return res.status(500).json({ error: 'Database error.' });
      }

      const results = products.map(p => {
        const obj = { name: p.name };
        const productProps = props.filter(pr => pr.product_id === p.id);
        for (const prop of productProps) {
          obj[prop.key] = prop.value;
        }
        return obj;
      });

      return res.status(200).json({ results });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});