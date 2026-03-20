'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`, (err) => {
    if (err) console.error('Error creating products table');
  });

  db.run(`CREATE TABLE IF NOT EXISTS product_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating product_properties table');
  });
});

// Helper: run a db query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
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

// POST /add
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

    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(rest)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input: all properties must be strings' });
      }
    }

    // Insert product
    let result;
    try {
      result = await dbRun('INSERT INTO products (name) VALUES (?)', [name.trim()]);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Product with this name already exists' });
      }
      throw err;
    }

    const productId = result.lastID;

    // Insert additional properties
    for (const [key, value] of Object.entries(rest)) {
      await dbRun(
        'INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)',
        [productId, key, value]
      );
    }

    return res.status(201).json({ message: 'Product successfully added' });
  } catch (err) {
    console.error('Error in /add:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /download
app.get('/download', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    const product = await dbGet('SELECT id, name FROM products WHERE name = ?', [name.trim()]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const properties = await dbAll(
      'SELECT key, value FROM product_properties WHERE product_id = ?',
      [product.id]
    );

    const productData = { name: product.name };
    for (const prop of properties) {
      productData[prop.key] = prop.value;
    }

    const data = JSON.stringify(productData);
    return res.status(200).json({ data });
  } catch (err) {
    console.error('Error in /download:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /upload
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
      return res.status(400).json({ error: 'Invalid upload query: data is required' });
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

    // Validate all properties are strings
    for (const [key, value] of Object.entries(parsedData)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query: all properties must be strings' });
      }
    }

    const trimmedName = name.trim();

    // Check if product exists
    const product = await dbGet('SELECT id FROM products WHERE name = ?', [trimmedName]);

    if (!product) {
      return res.status(400).json({ error: 'Invalid upload query: product not found' });
    }

    const productId = product.id;

    // Delete existing properties
    await dbRun('DELETE FROM product_properties WHERE product_id = ?', [productId]);

    // Insert new properties from data (excluding 'name' if present)
    for (const [key, value] of Object.entries(parsedData)) {
      if (key === 'name') continue; // name is stored in products table
      await dbRun(
        'INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)',
        [productId, key, value]
      );
    }

    return res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('Error in /upload:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /search
app.get('/search', async (req, res) => {
  try {
    const query = req.query.query;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    const searchTerm = `%${query.trim()}%`;

    // Find products matching by name or any property value
    const matchingProducts = await dbAll(
      `SELECT DISTINCT p.id, p.name FROM products p
       LEFT JOIN product_properties pp ON p.id = pp.product_id
       WHERE p.name LIKE ? OR pp.value LIKE ? OR pp.key LIKE ?`,
      [searchTerm, searchTerm, searchTerm]
    );

    const results = [];
    for (const product of matchingProducts) {
      const properties = await dbAll(
        'SELECT key, value FROM product_properties WHERE product_id = ?',
        [product.id]
      );
      const productObj = { name: product.name };
      for (const prop of properties) {
        productObj[prop.key] = prop.value;
      }
      results.push(productObj);
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('Error in /search:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});