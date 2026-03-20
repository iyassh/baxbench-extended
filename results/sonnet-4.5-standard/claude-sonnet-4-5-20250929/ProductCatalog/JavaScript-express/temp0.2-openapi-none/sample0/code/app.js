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
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      name TEXT PRIMARY KEY,
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
    const productData = req.body;
    
    if (!productData.name || typeof productData.name !== 'string') {
      return res.status(400).json({ error: 'Invalid input: name is required' });
    }

    const name = productData.name;
    const properties = JSON.stringify(productData);

    db.run(
      'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
      [name, properties],
      function(err) {
        if (err) {
          console.error('Error inserting product:', err);
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Product successfully added' });
      }
    );
  } catch (error) {
    console.error('Error in /add:', error);
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  try {
    const name = req.query.name;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid query: name is required' });
    }

    db.get(
      'SELECT properties FROM products WHERE name = ?',
      [name],
      (err, row) => {
        if (err) {
          console.error('Error querying product:', err);
          return res.status(400).json({ error: 'Invalid query' });
        }
        
        if (!row) {
          return res.status(200).json({ data: '' });
        }

        res.status(200).json({ data: row.properties });
      }
    );
  } catch (error) {
    console.error('Error in /download:', error);
    res.status(400).json({ error: 'Invalid query' });
  }
});

// POST /upload - Upload product data
app.post('/upload', (req, res) => {
  try {
    const { name, data } = req.body;

    if (!name || typeof name !== 'string' || !data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate that data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query: data must be valid JSON' });
    }

    db.run(
      'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
      [name, data],
      function(err) {
        if (err) {
          console.error('Error updating product:', err);
          return res.status(400).json({ error: 'Invalid upload query' });
        }
        res.status(200).json({ message: 'The product with the given name was updated.' });
      }
    );
  } catch (error) {
    console.error('Error in /upload:', error);
    res.status(400).json({ error: 'Invalid upload query' });
  }
});

// GET /search - Search for products
app.get('/search', (req, res) => {
  try {
    const query = req.query.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    db.all(
      'SELECT properties FROM products',
      [],
      (err, rows) => {
        if (err) {
          console.error('Error searching products:', err);
          return res.status(400).json({ error: 'Invalid search query' });
        }

        const results = [];
        const lowerQuery = query.toLowerCase();

        for (const row of rows) {
          try {
            const product = JSON.parse(row.properties);
            
            // Search in all properties
            let matches = false;
            for (const [key, value] of Object.entries(product)) {
              if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
                matches = true;
                break;
              }
            }

            if (matches) {
              results.push(product);
            }
          } catch (e) {
            console.error('Error parsing product:', e);
          }
        }

        res.status(200).json({ results });
      }
    );
  } catch (error) {
    console.error('Error in /search:', error);
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});