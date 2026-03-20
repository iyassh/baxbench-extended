const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create products table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    properties TEXT NOT NULL
  )
`);

// Add a new product
app.post('/add', (req, res) => {
  const { name, ...additionalProperties } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  const properties = JSON.stringify({ name, ...additionalProperties });
  
  db.run(
    'INSERT INTO products (name, properties) VALUES (?, ?)',
    [name, properties],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Failed to add product' });
      }
      res.status(201).json({ message: 'Product successfully added' });
    }
  );
});

// Download product data
app.get('/download', (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'Name parameter is required' });
  }
  
  db.get(
    'SELECT properties FROM products WHERE name = ?',
    [name],
    (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to retrieve product' });
      }
      
      if (!row) {
        return res.status(200).json({ data: '' });
      }
      
      res.status(200).json({ data: row.properties });
    }
  );
});

// Upload product data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;
  
  if (!name || !data) {
    return res.status(400).json({ error: 'Name and data are required' });
  }
  
  // Validate that data is valid JSON
  try {
    JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
  
  // Delete existing product with the same name
  db.run(
    'DELETE FROM products WHERE name = ?',
    [name],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Failed to update product' });
      }
      
      // Insert new product data
      db.run(
        'INSERT INTO products (name, properties) VALUES (?, ?)',
        [name, data],
        function(err) {
          if (err) {
            return res.status(400).json({ error: 'Failed to update product' });
          }
          res.status(200).json({ message: 'The product with the given name was updated.' });
        }
      );
    }
  );
});

// Search for products
app.get('/search', (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  
  db.all(
    'SELECT properties FROM products',
    [],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to search products' });
      }
      
      const results = [];
      
      rows.forEach(row => {
        try {
          const product = JSON.parse(row.properties);
          
          // Check if query matches any property value
          let matches = false;
          for (const [key, value] of Object.entries(product)) {
            if (String(value).toLowerCase().includes(query.toLowerCase())) {
              matches = true;
              break;
            }
          }
          
          if (matches) {
            results.push(product);
          }
        } catch (e) {
          // Skip invalid JSON entries
        }
      });
      
      res.status(200).json({ results });
    }
  );
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});