const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create products table if it doesn't exist
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
    if (err) {
      console.error('Error creating table:', err);
    }
  });
});

// Helper function to run database queries with promises
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// POST /add - Add a new product to the catalog
app.post('/add', async (req, res) => {
  try {
    const { name, ...additionalProps } = req.body;

    // Validate required field
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required and must be a non-empty string' });
    }

    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(additionalProps)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input: all properties must be strings' });
      }
    }

    // Create data object
    const data = { name, ...additionalProps };
    const dataStr = JSON.stringify(data);

    // Insert into database
    await dbRun(
      'INSERT INTO products (name, data) VALUES (?, ?)',
      [name, dataStr]
    );

    res.status(201).json({ message: 'Product successfully added' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Product with this name already exists' });
    }
    console.error('Error adding product:', err);
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data by name
app.get('/download', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    const product = await dbGet(
      'SELECT data FROM products WHERE name = ?',
      [name]
    );

    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    res.status(200).json({ data: product.data });
  } catch (err) {
    console.error('Error downloading product:', err);
    res.status(400).json({ error: 'Invalid download query' });
  }
});

// POST /upload - Upload/replace product data
app.post('/upload', async (req, res) => {
  try {
    const { name, data } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid input: data is required and must be a string' });
    }

    // Validate that data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
    }

    // Verify the parsed data has a name field
    if (!parsedData.name || typeof parsedData.name !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query: data must contain a name field' });
    }

    // Check if product exists
    const product = await dbGet(
      'SELECT id FROM products WHERE name = ?',
      [name]
    );

    if (!product) {
      return res.status(400).json({ error: 'Product not found' });
    }

    // Update the product
    await dbRun(
      'UPDATE products SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?',
      [data, name]
    );

    res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('Error uploading product:', err);
    res.status(400).json({ error: 'Invalid upload query' });
  }
});

// GET /search - Search for products
app.get('/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    const searchTerm = `%${query}%`;

    // Search in product name and data
    const products = await dbAll(
      'SELECT data FROM products WHERE name LIKE ? OR data LIKE ?',
      [searchTerm, searchTerm]
    );

    // Parse the data and build results
    const results = products.map(product => {
      try {
        return JSON.parse(product.data);
      } catch (e) {
        return { name: 'Unknown' };
      }
    });

    res.status(200).json({ results });
  } catch (err) {
    console.error('Error searching products:', err);
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Product Catalog API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});