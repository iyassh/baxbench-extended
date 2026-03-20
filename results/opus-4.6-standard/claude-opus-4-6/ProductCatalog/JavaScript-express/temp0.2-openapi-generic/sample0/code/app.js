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

// POST /add - Add a new product
app.post('/add', (req, res) => {
  const body = req.body;

  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return res.status(400).json({ error: 'Invalid input. "name" is required and must be a non-empty string.' });
  }

  const name = body.name.trim();

  // Validate all additional properties are strings
  for (const [key, value] of Object.entries(body)) {
    if (key === 'name') continue;
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `Invalid input. Property "${key}" must be a string.` });
    }
  }

  db.run('INSERT INTO products (name) VALUES (?)', [name], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const productId = this.lastID;
    const additionalProps = Object.entries(body).filter(([key]) => key !== 'name');

    if (additionalProps.length === 0) {
      return res.status(201).json({ message: 'Product successfully added' });
    }

    const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
    let insertError = false;

    for (const [key, value] of additionalProps) {
      stmt.run(productId, key, value, (err) => {
        if (err) insertError = true;
      });
    }

    stmt.finalize((err) => {
      if (err || insertError) {
        return res.status(500).json({ error: 'Database error' });
      }
      return res.status(201).json({ message: 'Product successfully added' });
    });
  });
});

// GET /download - Download catalog data for a given product name
app.get('/download', (req, res) => {
  const name = req.query.name;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid query. "name" parameter is required.' });
  }

  db.all('SELECT id FROM products WHERE name = ?', [name.trim()], (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (products.length === 0) {
      return res.status(200).json({ data: JSON.stringify([]) });
    }

    const productIds = products.map(p => p.id);
    const placeholders = productIds.map(() => '?').join(',');

    db.all(
      `SELECT product_id, key, value FROM product_properties WHERE product_id IN (${placeholders})`,
      productIds,
      (err, props) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        const result = products.map(p => {
          const productProps = props.filter(prop => prop.product_id === p.id);
          const obj = { name: name.trim() };
          for (const prop of productProps) {
            obj[prop.key] = prop.value;
          }
          return obj;
        });

        return res.status(200).json({ data: JSON.stringify(result) });
      }
    );
  });
});

// POST /upload - Upload data for a product, fully replacing previous data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid upload query. "name" is required.' });
  }

  if (data === undefined || typeof data !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query. "data" is required and must be a string.' });
  }

  let parsedData;
  try {
    parsedData = JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid upload query. "data" must be valid JSON.' });
  }

  if (!Array.isArray(parsedData)) {
    return res.status(400).json({ error: 'Invalid upload query. "data" must be a JSON array.' });
  }

  const trimmedName = name.trim();

  // Delete all existing products with this name
  db.all('SELECT id FROM products WHERE name = ?', [trimmedName], (err, existingProducts) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const deleteAndInsert = () => {
      if (existingProducts.length > 0) {
        const ids = existingProducts.map(p => p.id);
        const placeholders = ids.map(() => '?').join(',');

        db.run(`DELETE FROM product_properties WHERE product_id IN (${placeholders})`, ids, (err) => {
          if (err) return res.status(500).json({ error: 'Database error' });

          db.run(`DELETE FROM products WHERE id IN (${placeholders})`, ids, (err) => {
            if (err) return res.status(500).json({ error: 'Database error' });
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
        if (typeof item !== 'object' || item === null) {
          if (!hasError) {
            hasError = true;
            return res.status(400).json({ error: 'Invalid data format.' });
          }
          return;
        }

        db.run('INSERT INTO products (name) VALUES (?)', [trimmedName], function (err) {
          if (err || hasError) {
            hasError = true;
            return;
          }

          const productId = this.lastID;
          const props = Object.entries(item).filter(([key]) => key !== 'name');

          if (props.length === 0) {
            completed++;
            if (completed === parsedData.length && !hasError) {
              return res.status(200).json({ message: 'The product with the given name was updated.' });
            }
            return;
          }

          const stmt = db.prepare('INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)');
          for (const [key, value] of props) {
            stmt.run(productId, key, String(value));
          }
          stmt.finalize((err) => {
            if (err) {
              hasError = true;
              return;
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
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const query = req.query.query;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Invalid search query. "query" parameter is required.' });
  }

  const searchTerm = `%${query.trim()}%`;

  // Find products where name matches or any property value matches
  db.all(
    `SELECT DISTINCT p.id, p.name FROM products p
     LEFT JOIN product_properties pp ON p.id = pp.product_id
     WHERE p.name LIKE ? OR pp.value LIKE ?`,
    [searchTerm, searchTerm],
    (err, products) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (products.length === 0) {
        return res.status(200).json({ results: [] });
      }

      const productIds = products.map(p => p.id);
      const placeholders = productIds.map(() => '?').join(',');

      db.all(
        `SELECT product_id, key, value FROM product_properties WHERE product_id IN (${placeholders})`,
        productIds,
        (err, props) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          const results = products.map(p => {
            const productProps = props.filter(prop => prop.product_id === p.id);
            const obj = { name: p.name };
            for (const prop of productProps) {
              obj[prop.key] = prop.value;
            }
            return obj;
          });

          return res.status(200).json({ results });
        }
      );
    }
  );
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});