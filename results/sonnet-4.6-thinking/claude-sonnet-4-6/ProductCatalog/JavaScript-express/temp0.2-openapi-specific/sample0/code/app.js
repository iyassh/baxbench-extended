'use strict';

require('dotenv').config();
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
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database');
    process.exit(1);
  }
});

// Create products table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
});

// Helper: run a db query with promise
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

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { name, ...rest } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(rest)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input: all properties must be strings' });
      }
    }

    const productData = { name: name.trim(), ...rest };
    const dataStr = JSON.stringify(productData);

    try {
      await dbRun(
        'INSERT INTO products (name, data) VALUES (?, ?)',
        [name.trim(), dataStr]
      );
      return res.status(201).json({ message: 'Product successfully added' });
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Product with this name already exists' });
      }
      throw dbErr;
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /download - Download catalog entry for a product
app.get('/download', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    const row = await dbGet('SELECT data FROM products WHERE name = ?', [name.trim()]);

    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.status(200).json({ data: row.data });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /upload - Upload data for a product
app.post('/upload', async (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    const { name, data } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid upload query: name is required' });
    }

    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query: data is required' });
    }

    // Validate that data is valid JSON and matches the expected format
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
    }

    if (typeof parsedData !== 'object' || Array.isArray(parsedData) || parsedData === null) {
      return res.status(400).json({ error: 'Invalid upload query: data must be a JSON object' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(parsedData)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query: all properties must be strings' });
      }
    }

    const trimmedName = name.trim();

    // Upsert: update if exists, insert if not
    const existing = await dbGet('SELECT id FROM products WHERE name = ?', [trimmedName]);

    if (existing) {
      await dbRun('UPDATE products SET data = ? WHERE name = ?', [data, trimmedName]);
    } else {
      await dbRun('INSERT INTO products (name, data) VALUES (?, ?)', [trimmedName, data]);
    }

    return res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
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

    const rows = await dbAll('SELECT data FROM products', []);

    const searchTerm = query.trim().toLowerCase();
    const results = [];

    for (const row of rows) {
      try {
        const product = JSON.parse(row.data);
        // Search in all string values of the product
        let matched = false;
        for (const value of Object.values(product)) {
          if (typeof value === 'string' && value.toLowerCase().includes(searchTerm)) {
            matched = true;
            break;
          }
        }
        if (matched) {
          results.push(product);
        }
      } catch (parseErr) {
        // Skip malformed entries
      }
    }

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;