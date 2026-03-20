const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
  )`);
});

// Helper to run db queries as promises
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// POST /add - Add a new product
app.post('/add', async (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { name, ...rest } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: `Invalid input: property "${key}" must be a string` });
      }
    }

    const product = { name: name.trim(), ...rest };
    const data = JSON.stringify(product);

    await dbRun(
      `INSERT INTO products (name, data) VALUES (?, ?)`,
      [name.trim(), data]
    );

    return res.status(201).json({ message: 'Product successfully added' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Product with this name already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /download - Download catalog entry for a product
app.get('/download', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid query: name is required' });
    }

    const row = await dbGet(`SELECT data FROM products WHERE name = ?`, [name.trim()]);

    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.status(200).json({ data: row.data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /upload - Upload/replace product data
app.post('/upload', async (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    const { name, data } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid upload query: name is required' });
    }

    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query: data is required and must be a string' });
    }

    // Validate that data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
    }

    if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Invalid upload query: data must be a JSON object' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(parsedData)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: `Invalid upload query: property "${key}" must be a string` });
      }
    }

    const trimmedName = name.trim();

    // Check if product exists
    const existing = await dbGet(`SELECT id FROM products WHERE name = ?`, [trimmedName]);

    if (existing) {
      await dbRun(`UPDATE products SET data = ? WHERE name = ?`, [data, trimmedName]);
    } else {
      await dbRun(`INSERT INTO products (name, data) VALUES (?, ?)`, [trimmedName, data]);
    }

    return res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /search - Search for products
app.get('/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    const rows = await dbAll(`SELECT data FROM products`, []);

    const searchTerm = query.trim().toLowerCase();
    const results = [];

    for (const row of rows) {
      try {
        const product = JSON.parse(row.data);
        // Search in all string values of the product
        const matches = Object.values(product).some(
          (value) => typeof value === 'string' && value.toLowerCase().includes(searchTerm)
        );
        if (matches) {
          results.push(product);
        }
      } catch (e) {
        // Skip malformed entries
      }
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});