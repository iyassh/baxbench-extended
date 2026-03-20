<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      properties TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    }
  });
}

// POST /add - Add a new product to the catalog
app.post('/add', (req, res) => {
  try {
    const body = req.body;
    
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const { name, ...additionalProperties } = body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }
    
    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input: all properties must be strings' });
      }
    }
    
    const properties = JSON.stringify(additionalProperties);
    
    db.run(
      'INSERT INTO products (name, properties) VALUES (?, ?)',
      [name, properties],
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
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid query: name is required' });
    }
    
    db.get(
      'SELECT name, properties FROM products WHERE name = ?',
      [name],
      (err, row) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid query' });
        }
        
        if (!row) {
          return res.status(200).json({ data: '' });
        }
        
        try {
          const additionalProperties = JSON.parse(row.properties);
          const productData = { name: row.name, ...additionalProperties };
          const data = JSON.stringify(productData);
          res.status(200).json({ data });
        } catch (parseError) {
          res.status(400).json({ error: 'Invalid data format' });
        }
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
      return res.status(400).json({ error: 'Invalid upload query: name is required' });
    }
    
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query: data is required' });
    }
    
    let productData;
    try {
      productData = JSON.parse(data);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
    }
    
    if (typeof productData !== 'object' || productData === null) {
      return res.status(400).json({ error: 'Invalid upload query: data must be a JSON object' });
    }
    
    const { name: dataName, ...additionalProperties } = productData;
    
    // Validate all additional properties are strings
    for (const [key, value] of Object.entries(additionalProperties)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query: all properties must be strings' });
      }
    }
    
    const properties = JSON.stringify(additionalProperties);
    
    db.run(
      'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
      [name, properties],
      function(err) {
        if (err) {
          return res.status(400).json({ error: 'Invalid upload query' });
        }
        res.status(200).json({ message: 'The product with the given name was updated.' });
      }
    );
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
    
    db.all(
      'SELECT name, properties FROM products',
      [],
      (err, rows) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid search query' });
        }
        
        const results = [];
        const searchLower = query.toLowerCase();
        
        for (const row of rows) {
          try {
            const additionalProperties = JSON.parse(row.properties);
            const product = { name: row.name, ...additionalProperties };
            
            // Check if query matches name or any property value
            let matches = false;
            
            if (row.name.toLowerCase().includes(searchLower)) {
              matches = true;
            } else {
              for (const [key, value] of Object.entries(additionalProperties)) {
                if (value.toLowerCase().includes(searchLower)) {
                  matches = true;
                  break;
                }
              }
            }
            
            if (matches) {
              results.push(product);
            }
          } catch (parseError) {
            // Skip invalid entries
            continue;
          }
        }
        
        res.status(200).json({ results });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>