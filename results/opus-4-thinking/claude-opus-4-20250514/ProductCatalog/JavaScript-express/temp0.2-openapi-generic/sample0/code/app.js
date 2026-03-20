const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create products table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      properties TEXT NOT NULL
    )
  `);
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  const { name, ...additionalProperties } = req.body;
  
  if (!name || typeof name !== 'string') {
    return res.status(400).send();
  }
  
  // Validate that all additional properties are strings
  const allProperties = { name, ...additionalProperties };
  for (const [key, value] of Object.entries(allProperties)) {
    if (typeof value !== 'string') {
      return res.status(400).send();
    }
  }
  
  const properties = JSON.stringify(allProperties);
  
  db.run(
    'INSERT INTO products (name, properties) VALUES (?, ?)',
    [name, properties],
    function(err) {
      if (err) {
        return res.status(400).send();
      }
      res.status(201).send();
    }
  );
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).send();
  }
  
  db.get(
    'SELECT properties FROM products WHERE name = ?',
    [name],
    (err, row) => {
      if (err) {
        return res.status(500).send();
      }
      
      if (!row) {
        // Return empty data if product not found
        return res.json({ data: '' });
      }
      
      res.json({ data: row.properties });
    }
  );
});

// POST /upload - Upload product data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;
  
  if (!name || typeof name !== 'string' || !data || typeof data !== 'string') {
    return res.status(400).send();
  }
  
  // Validate that data is valid JSON and contains the correct structure
  let parsedData;
  try {
    parsedData = JSON.parse(data);
  } catch (e) {
    return res.status(400).send();
  }
  
  // Ensure all values are strings and it's a valid object
  if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
    return res.status(400).send();
  }
  
  for (const [key, value] of Object.entries(parsedData)) {
    if (typeof value !== 'string') {
      return res.status(400).send();
    }
  }
  
  // Update the name to match the parameter
  parsedData.name = name;
  const updatedData = JSON.stringify(parsedData);
  
  db.run(
    'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
    [name, updatedData],
    function(err) {
      if (err) {
        return res.status(400).send();
      }
      res.status(200).send();
    }
  );
});

// GET /search - Search products
app.get('/search', (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).send();
  }
  
  db.all(
    'SELECT properties FROM products',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).send();
      }
      
      const results = [];
      const searchLower = query.toLowerCase();
      
      for (const row of rows) {
        try {
          const product = JSON.parse(row.properties);
          let match = false;
          
          // Check if any property value contains the search query
          for (const value of Object.values(product)) {
            if (value && typeof value === 'string' && value.toLowerCase().includes(searchLower)) {
              match = true;
              break;
            }
          }
          
          if (match) {
            results.push(product);
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
      
      res.json({ results });
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});