const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create products table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL
    )
  `);
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  const { name } = req.body;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).end();
  }
  
  // Validate all properties are strings
  for (const value of Object.values(req.body)) {
    if (typeof value !== 'string') {
      return res.status(400).end();
    }
  }
  
  // Store all properties
  const productData = req.body;
  
  // Insert into database
  db.run(
    'INSERT INTO products (name, data) VALUES (?, ?)',
    [name, JSON.stringify(productData)],
    function(err) {
      if (err) {
        return res.status(400).end();
      }
      res.status(201).end();
    }
  );
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).end();
  }
  
  db.get(
    'SELECT data FROM products WHERE name = ?',
    [name],
    (err, row) => {
      if (err) {
        return res.status(400).end();
      }
      if (!row) {
        return res.status(200).json({ data: "" });
      }
      res.status(200).json({ data: row.data });
    }
  );
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;
  
  if (!name || !data || typeof name !== 'string' || typeof data !== 'string') {
    return res.status(400).end();
  }
  
  // Validate that data is valid JSON
  let parsed;
  try {
    parsed = JSON.parse(data);
    // Ensure all properties in the data are strings
    for (const value of Object.values(parsed)) {
      if (typeof value !== 'string') {
        return res.status(400).end();
      }
    }
  } catch (e) {
    return res.status(400).end();
  }
  
  // Update the product with the given name
  db.run(
    'UPDATE products SET data = ? WHERE name = ?',
    [data, name],
    function(err) {
      if (err) {
        return res.status(400).end();
      }
      if (this.changes === 0) {
        // Product doesn't exist
        return res.status(400).end();
      }
      res.status(200).end();
    }
  );
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const { query } = req.query;
  
  if (!query || typeof query !== 'string') {
    return res.status(400).end();
  }
  
  // Get all products and search through their data
  db.all(
    'SELECT data FROM products',
    [],
    (err, rows) => {
      if (err) {
        return res.status(400).end();
      }
      
      const results = [];
      const lowerQuery = query.toLowerCase();
      
      for (const row of rows) {
        try {
          const product = JSON.parse(row.data);
          let match = false;
          
          // Check if query matches any property value
          for (const value of Object.values(product)) {
            if (value.toLowerCase().includes(lowerQuery)) {
              match = true;
              break;
            }
          }
          
          if (match) {
            results.push(product);
          }
        } catch (e) {
          // Skip invalid JSON data
        }
      }
      
      res.status(200).json({ results });
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});