const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL DEFAULT '{}'
  )`);
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  const body = req.body;
  
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  const { name, ...rest } = body;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid input: name is required' });
  }
  
  // Validate all properties are strings
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value !== 'string') {
      return res.status(400).json({ error: `Invalid input: property ${key} must be a string` });
    }
  }
  
  const productData = { name, ...rest };
  const dataStr = JSON.stringify(productData);
  
  db.run(
    `INSERT INTO products (name, data) VALUES (?, ?)`,
    [name, dataStr],
    function(err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Product with this name already exists' });
        }
        return res.status(400).json({ error: 'Invalid input' });
      }
      return res.status(201).json({ message: 'Product successfully added' });
    }
  );
});

// GET /download - Download catalog entry for a product
app.get('/download', (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'name parameter is required' });
  }
  
  db.get(
    `SELECT data FROM products WHERE name = ?`,
    [name],
    (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      if (!row) {
        return res.status(200).json({ data: '' });
      }
      return res.status(200).json({ data: row.data });
    }
  );
});

// POST /upload - Upload data for a product
app.post('/upload', (req, res) => {
  const { name, data } = req.body;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: name is required' });
  }
  
  if (data === undefined || data === null || typeof data !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: data is required' });
  }
  
  // Validate data is valid JSON
  let parsedData;
  try {
    parsedData = JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
  }
  
  // Upsert the product
  db.run(
    `INSERT INTO products (name, data) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
    [name, data],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
      return res.status(200).json({ message: 'Product updated successfully' });
    }
  );
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Invalid search query: query parameter is required' });
  }
  
  db.all(
    `SELECT data FROM products`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      
      const results = [];
      const lowerQuery = query.toLowerCase();
      
      for (const row of rows) {
        try {
          const product = JSON.parse(row.data);
          // Check if query matches any property value
          let matches = false;
          for (const [key, value] of Object.entries(product)) {
            if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
              matches = true;
              break;
            }
          }
          if (matches) {
            results.push(product);
          }
        } catch (e) {
          // Skip invalid data
        }
      }
      
      return res.status(200).json({ results });
    }
  );
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});