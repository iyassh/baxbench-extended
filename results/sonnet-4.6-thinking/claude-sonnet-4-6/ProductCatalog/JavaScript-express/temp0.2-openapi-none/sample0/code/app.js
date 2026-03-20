const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    properties TEXT NOT NULL DEFAULT '{}'
  )`);
});

// POST /add
app.post('/add', (req, res) => {
  const body = req.body;
  if (!body || typeof body.name !== 'string' || !body.name) {
    return res.status(400).json({ error: 'Invalid input: name is required' });
  }

  const { name, ...rest } = body;

  // Validate all additional properties are strings
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `Invalid input: property ${key} must be a string` });
    }
  }

  const properties = JSON.stringify(rest);

  db.run('INSERT INTO products (name, properties) VALUES (?, ?)', [name, properties], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Failed to add product' });
    }
    return res.status(201).json({ message: 'Product successfully added' });
  });
});

// GET /download
app.get('/download', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'name query parameter is required' });
  }

  db.get('SELECT * FROM products WHERE name = ?', [name], (err, row) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(200).json({ data: JSON.stringify({ name: name, properties: {} }) });
    }

    const data = JSON.stringify({ name: row.name, properties: JSON.parse(row.properties) });
    return res.status(200).json({ data });
  });
});

// POST /upload
app.post('/upload', (req, res) => {
  const { name, data } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: name is required' });
  }

  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: data is required' });
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
  }

  if (!parsed || typeof parsed !== 'object') {
    return res.status(400).json({ error: 'Invalid upload query: data must be a JSON object' });
  }

  const properties = parsed.properties || {};
  const propertiesStr = JSON.stringify(properties);

  // Check if product exists
  db.get('SELECT * FROM products WHERE name = ?', [name], (err, row) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }

    if (row) {
      db.run('UPDATE products SET properties = ? WHERE name = ?', [propertiesStr, name], function(err) {
        if (err) {
          return res.status(400).json({ error: 'Failed to update product' });
        }
        return res.status(200).json({ message: 'Product updated' });
      });
    } else {
      db.run('INSERT INTO products (name, properties) VALUES (?, ?)', [name, propertiesStr], function(err) {
        if (err) {
          return res.status(400).json({ error: 'Failed to insert product' });
        }
        return res.status(200).json({ message: 'Product updated' });
      });
    }
  });
});

// GET /search
app.get('/search', (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Invalid search query: query parameter is required' });
  }

  db.all('SELECT * FROM products', [], (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }

    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const row of rows) {
      let properties = {};
      try {
        properties = JSON.parse(row.properties);
      } catch (e) {
        properties = {};
      }

      let matches = false;

      if (row.name.toLowerCase().includes(lowerQuery)) {
        matches = true;
      }

      if (!matches) {
        for (const value of Object.values(properties)) {
          if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
            matches = true;
            break;
          }
        }
      }

      if (matches) {
        results.push({ name: row.name, ...properties });
      }
    }

    return res.status(200).json({ results });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});