const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database initialization
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
});

// Initialize database schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err && !err.message.includes('already exists')) {
      console.error('Schema creation error:', err.message);
    }
  });
});

// Helper function to run database queries with proper error handling
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
};

// POST /add - Add a new product
app.post('/add', async (req, res) => {
  try {
    const { name, ...additionalProps } = req.body;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Product name is required and must be a non-empty string' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(additionalProps)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'All product properties must be strings' });
      }
    }

    // Create product data object
    const productData = { name, ...additionalProps };
    const dataJson = JSON.stringify(productData);

    // Insert into database using parameterized query
    await dbRun(
      'INSERT INTO products (name, data) VALUES (?, ?)',
      [name.trim(), dataJson]
    );

    res.status(201).json({ message: 'Product successfully added' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Product with this name already exists' });
    }
    console.error('Add product error:', err.message);
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data
app.get('/download', async (req, res) => {
  try {
    const { name } = req.query;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Query database using parameterized query
    const product = await dbGet(
      'SELECT data FROM products WHERE name = ?',
      [name.trim()]
    );

    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    res.status(200).json({ data: product.data });
  } catch (err) {
    console.error('Download error:', err.message);
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// POST /upload - Upload/replace product data
app.post('/upload', async (req, res) => {
  try {
    const { name, data } = req.body;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Product name is required' });
    }

    if (!data || typeof data !== 'string' || data.trim() === '') {
      return res.status(400).json({ error: 'Product data is required' });
    }

    // Validate that data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Product data must be valid JSON' });
    }

    // Validate that parsed data is an object
    if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Product data must be a JSON object' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(parsedData)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'All product properties must be strings' });
      }
    }

    // Check if product exists
    const product = await dbGet(
      'SELECT id FROM products WHERE name = ?',
      [name.trim()]
    );

    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Update product data using parameterized query
    await dbRun(
      'UPDATE products SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?',
      [data, name.trim()]
    );

    res.status(200).json({ message: 'Product successfully updated' });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(400).json({ error: 'Invalid upload query' });
  }
});

// GET /search - Search for products
app.get('/search', async (req, res) => {
  try {
    const { query } = req.query;

    // Validate input
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchTerm = `%${query.trim()}%`;

    // Search using parameterized query to prevent SQL injection
    const products = await dbAll(
      'SELECT data FROM products WHERE data LIKE ?',
      [searchTerm]
    );

    // Parse and filter results
    const results = [];
    for (const product of products) {
      try {
        const parsedData = JSON.parse(product.data);
        results.push(parsedData);
      } catch (e) {
        // Skip malformed entries
        continue;
      }
    }

    res.status(200).json({ results });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Product Catalog API listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Database close error:', err.message);
    }
    process.exit(0);
  });
});