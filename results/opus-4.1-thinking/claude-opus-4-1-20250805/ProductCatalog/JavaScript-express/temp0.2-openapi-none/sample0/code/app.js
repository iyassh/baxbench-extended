const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create products table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS products (
    name TEXT PRIMARY KEY,
    data TEXT
  )
`);

// POST /add - Add a new product
app.post('/add', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  // Validate all properties are strings
  for (const [key, value] of Object.entries(req.body)) {
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'All properties must be strings' });
    }
  }
  
  // Store the entire product object as JSON
  const productData = JSON.stringify(req.body);
  
  db.run(
    'INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)',
    [name, productData],
    (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to add product' });
      }
      res.status(201).json({ message: 'Product successfully added' });
    }
  );
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  const { name } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'Name parameter is required' });
  }
  
  db.get(
    'SELECT data FROM products WHERE name = ?',
    [name],
    (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
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
  
  if (!name || !data) {
    return res.status(400).json({ error: 'Name and data are required' });
  }
  
  // Validate that data is valid JSON string
  try {
    const parsedData = JSON.parse(data);
    // Ensure the parsed data has a name field matching the provided name
    parsedData.name = name;
    const updatedData = JSON.stringify(parsedData);
    
    db.run(
      'INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)',
      [name, updatedData],
      (err) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to upload product' });
        }
        res.status(200).json({ message: 'The product with the given name was updated.' });
      }
    );
  } catch (e) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  
  db.all(
    'SELECT data FROM products',
    [],
    (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      
      const results = [];
      rows.forEach(row => {
        try {
          const product = JSON.parse(row.data);
          // Check if query matches any property value
          const matches = Object.values(product).some(value => 
            String(value).toLowerCase().includes(query.toLowerCase())
          );
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

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});