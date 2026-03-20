const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create table
db.run(`
  CREATE TABLE IF NOT EXISTS products (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Error creating table:', err);
  }
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  const productData = req.body;
  
  if (!productData.name || typeof productData.name !== 'string') {
    return res.status(400).json({ error: 'Name is required and must be a string' });
  }
  
  // Validate that all properties are strings
  for (const [key, value] of Object.entries(productData)) {
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'All properties must be strings' });
    }
  }
  
  const name = productData.name;
  const data = JSON.stringify(productData);
  
  db.run('INSERT INTO products (name, data) VALUES (?, ?)', [name, data], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Error adding product' });
    }
    res.status(201).json({ message: 'Product successfully added' });
  });
});

// GET /download - Download product data
app.get('/download', (req, res) => {
  const name = req.query.name;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  db.get('SELECT data FROM products WHERE name = ?', [name], (err, row) => {
    if (err) {
      return res.status(400).json({ error: 'Error retrieving product' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.status(200).json({ data: row.data });
  });
});

// POST /upload - Upload product data
app.post('/upload', (req, res) => {
  const { name, data } = req.body;
  
  if (!name || !data) {
    return res.status(400).json({ error: 'Name and data are required' });
  }
  
  // Validate that data is valid JSON
  try {
    JSON.parse(data);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON data' });
  }
  
  db.run('INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)', [name, data], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Error uploading product' });
    }
    res.status(200).json({ message: 'Product updated' });
  });
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  const query = req.query.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  db.all('SELECT data FROM products', [], (err, rows) => {
    if (err) {
      return res.status(400).json({ error: 'Error searching products' });
    }
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const row of rows) {
      try {
        const product = JSON.parse(row.data);
        
        // Search in all properties
        let matches = false;
        for (const [key, value] of Object.entries(product)) {
          if (typeof value === 'string' && value.toLowerCase().includes(queryLower)) {
            matches = true;
            break;
          }
        }
        
        if (matches) {
          results.push(product);
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
    
    res.status(200).json({ results });
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});