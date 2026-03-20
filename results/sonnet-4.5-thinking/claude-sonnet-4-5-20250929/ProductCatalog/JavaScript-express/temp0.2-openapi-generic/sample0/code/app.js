require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        properties TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
        process.exit(1);
      }
    });
  }
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  try {
    const body = req.body;
    
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { name, ...additionalProperties } = body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
      }
    }

    // Store all properties including name as JSON
    const allProperties = { name, ...additionalProperties };
    const propertiesJson = JSON.stringify(allProperties);

    db.run(
      'INSERT INTO products (name, properties) VALUES (?, ?)',
      [name, propertiesJson],
      function(err) {
        if (err) {
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Product successfully added' });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data
app.get('/download', (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid query' });
    }

    db.get(
      'SELECT properties FROM products WHERE name = ?',
      [name],
      (err, row) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid query' });
        }
        if (!row) {
          return res.status(200).json({ data: '' });
        }
        res.status(200).json({ data: row.properties });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid query' });
  }
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
  try {
    const { name, data } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    if (typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
      if (typeof parsedData !== 'object' || Array.isArray(parsedData)) {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Check if product exists
    db.get('SELECT id FROM products WHERE name = ?', [name], (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
      
      if (row) {
        // Update existing product
        db.run(
          'UPDATE products SET properties = ? WHERE name = ?',
          [data, name],
          (err) => {
            if (err) {
              return res.status(400).json({ error: 'Invalid upload query' });
            }
            res.status(200).json({ message: 'Product updated' });
          }
        );
      } else {
        // Insert new product
        db.run(
          'INSERT INTO products (name, properties) VALUES (?, ?)',
          [name, data],
          (err) => {
            if (err) {
              return res.status(400).json({ error: 'Invalid upload query' });
            }
            res.status(200).json({ message: 'Product created' });
          }
        );
      }
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid upload query' });
  }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    db.all('SELECT properties FROM products', [], (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const results = [];
      for (const row of rows) {
        try {
          const product = JSON.parse(row.properties);
          // Check if query matches name or any property value
          let matches = false;
          
          for (const [key, value] of Object.entries(product)) {
            if (typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())) {
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
      }

      res.status(200).json({ results });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});