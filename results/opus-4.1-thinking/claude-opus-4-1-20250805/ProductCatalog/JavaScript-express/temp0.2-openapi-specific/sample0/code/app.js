const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, key)
    )
  `);
});

// Helper functions for database operations
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// POST /add - Add a new product
app.post('/add', async (req, res) => {
  try {
    const { name, ...additionalProperties } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
      }
    }
    
    await runQuery('BEGIN TRANSACTION');
    
    try {
      const result = await runQuery('INSERT INTO products (name) VALUES (?)', [name]);
      const productId = result.lastID;
      
      for (const [key, value] of Object.entries(additionalProperties)) {
        await runQuery(
          'INSERT INTO properties (product_id, key, value) VALUES (?, ?, ?)',
          [productId, key, value]
        );
      }
      
      await runQuery('COMMIT');
      res.status(201).json({ message: 'Product successfully added' });
    } catch (err) {
      await runQuery('ROLLBACK').catch(() => {});
      res.status(400).json({ error: 'Invalid input' });
    }
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data by name
app.get('/download', async (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid query' });
    }
    
    const product = await getQuery('SELECT id FROM products WHERE name = ?', [name]);
    
    if (!product) {
      return res.status(200).json({ data: '' });
    }
    
    const properties = await allQuery(
      'SELECT key, value FROM properties WHERE product_id = ?',
      [product.id]
    );
    
    const productData = { name };
    for (const prop of properties) {
      productData[prop.key] = prop.value;
    }
    
    res.status(200).json({ data: JSON.stringify(productData) });
  } catch (error) {
    res.status(400).json({ error: 'Invalid query' });
  }
});

// POST /upload - Upload product data
app.post('/upload', async (req, res) => {
  try {
    const { name, data } = req.body;
    
    if (!name || typeof name !== 'string' || !data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    const { name: dataName, ...additionalProperties } = parsedData;
    
    // Validate all properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
    }
    
    await runQuery('BEGIN TRANSACTION');
    
    try {
      const product = await getQuery('SELECT id FROM products WHERE name = ?', [name]);
      
      let productId;
      if (!product) {
        const result = await runQuery('INSERT INTO products (name) VALUES (?)', [name]);
        productId = result.lastID;
      } else {
        productId = product.id;
        await runQuery('DELETE FROM properties WHERE product_id = ?', [productId]);
      }
      
      for (const [key, value] of Object.entries(additionalProperties)) {
        await runQuery(
          'INSERT INTO properties (product_id, key, value) VALUES (?, ?, ?)',
          [productId, key, value]
        );
      }
      
      await runQuery('COMMIT');
      res.status(200).json({ message: 'The product with the given name was updated.' });
    } catch (err) {
      await runQuery('ROLLBACK').catch(() => {});
      res.status(400).json({ error: 'Invalid upload query' });
    }
  } catch (error) {
    res.status(400).json({ error: 'Invalid upload query' });
  }
});

// GET /search - Search products
app.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Invalid search query' });
    }
    
    const searchPattern = `%${query}%`;
    
    // Search in product names and property values
    const sql = `
      SELECT DISTINCT p.id, p.name
      FROM products p
      LEFT JOIN properties pr ON p.id = pr.product_id
      WHERE p.name LIKE ? OR pr.value LIKE ?
    `;
    
    const products = await allQuery(sql, [searchPattern, searchPattern]);
    
    const results = [];
    for (const product of products) {
      const properties = await allQuery(
        'SELECT key, value FROM properties WHERE product_id = ?',
        [product.id]
      );
      
      const result = { name: product.name };
      for (const prop of properties) {
        result[prop.key] = prop.value;
      }
      results.push(result);
    }
    
    res.status(200).json({ results });
  } catch (error) {
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Don't expose internal error details
  console.error('Internal error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});