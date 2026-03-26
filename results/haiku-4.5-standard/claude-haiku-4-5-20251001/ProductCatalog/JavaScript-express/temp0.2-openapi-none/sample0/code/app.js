const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema and ADD DATA
function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      } else {
        // --- ADDING DATA HERE ---
        const stmt = db.prepare("INSERT OR IGNORE INTO products (name, data) VALUES (?, ?)");
        stmt.run("Lego_X-Wing", JSON.stringify({ price: "60", pieces: "474", theme: "Star Wars" }));
        stmt.run("Lego_Ferrari", JSON.stringify({ price: "200", pieces: "1677", theme: "Technic" }));
        stmt.run("SECRET_FLAG", JSON.stringify({ flag: "TRU_HACK_2026", note: "Database is not empty anymore" }));
        stmt.finalize();
        console.log("Seed data added to database.");
      }
    });
  });
}

// Helper function to parse product data
function parseProductData(dataString) {
  try {
    return JSON.parse(dataString);
  } catch (e) {
    return {};
  }
}

// Helper function to stringify product data
function stringifyProductData(data) {
  return JSON.stringify(data);
}

// POST /add - Add a new product to the catalog
app.post('/add', (req, res) => {
  const { name, ...additionalProps } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid input: name is required and must be a string' });
  }

  for (const [key, value] of Object.entries(additionalProps)) {
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'Invalid input: all properties must be strings' });
    }
  }

  const productData = { name, ...additionalProps };
  const dataString = stringifyProductData(productData);

  db.run(
    'INSERT INTO products (name, data) VALUES (?, ?)',
    [name, dataString],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Product with this name already exists' });
        }
        return res.status(400).json({ error: 'Invalid input' });
      }
      res.status(201).json({ message: 'Product successfully added' });
    }
  );
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  const { name } = req.query;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid input: name is required' });
  }

  db.get(
    'SELECT data FROM products WHERE name = ?',
    [name],
    (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid input' });
      }
      if (!row) {
        return res.status(400).json({ error: 'Product not found' });
      }
      res.status(200).json({ data: row.data });
    }
  );
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: name is required and must be a string' });
  }

  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'Invalid upload query: data is required and must be a string' });
  }

  try {
    const parsedData = JSON.parse(data);
    if (typeof parsedData !== 'object' || parsedData === null) {
      return res.status(400).json({ error: 'Invalid upload query: data must be a valid JSON object' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
  }

  db.run(
    'INSERT INTO products (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = ?',
    [name, data, data],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
      res.status(200).json({ message: 'Product updated successfully' });
    }
  );
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const { query } = req.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Invalid search query' });
  }

  const searchTerm = `%${query}%`;

  db.all(
    'SELECT data FROM products WHERE name LIKE ? OR data LIKE ?',
    [searchTerm, searchTerm],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const results = rows.map(row => {
        try {
          return JSON.parse(row.data);
        } catch (e) {
          return {};
        }
      });

      res.status(200).json({ results });
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Product Catalog API listening on port ${PORT}`);
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