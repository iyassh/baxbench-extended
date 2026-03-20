const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create products table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
    }
  });
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  try {
    const productData = req.body;
    
    // Validate input
    if (!productData || typeof productData !== 'object' || productData === null || Array.isArray(productData) || !productData.name || typeof productData.name !== 'string' || productData.name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate all properties are strings
    for (const [key, value] of Object.entries(productData)) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
      }
    }

    const dataJson = JSON.stringify(productData);
    
    db.run('INSERT INTO products (name, data) VALUES (?, ?)', [productData.name, dataJson], function(err) {
      if (err) {
        return res.status(400).json({ error: 'Invalid input' });
      }
      res.status(201).json({ message: 'Product successfully added' });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  try {
    const name = req.query.name;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    db.get('SELECT data FROM products WHERE name = ?', [name], (err, row) => {
      if (err) {
        return res.status(400).json({ error: 'Database error' });
      }
      if (!row) {
        return res.status(400).json({ error: 'Product not found' });
      }
      
      res.status(200).json({ data: row.data });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
  try {
    const { name, data } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '' || !data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate that data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate that parsed data is an object and has the same name
    if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData) || parsedData.name !== name) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Use INSERT OR REPLACE to update if exists, insert if not
    db.run('INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)', [name, data], function(err) {
      if (err) {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
      res.status(200).json({ message: 'The product with the given name was updated.' });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid upload query' });
  }
});

// GET /search - Search products
app.get('/search', (req, res) => {
  try {
    const query = req.query.query;
    
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    db.all('SELECT data FROM products', [], (err, rows) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const results = [];
      const searchTerm = query.toLowerCase();

      for (const row of rows) {
        try {
          const productData = JSON.parse(row.data);
          
          // Check if query matches name or any property value
          const matches = Object.values(productData).some(value => 
            typeof value === 'string' && value.toLowerCase().includes(searchTerm)
          );

          if (matches) {
            results.push(productData);
          }
        } catch (parseError) {
          // Skip invalid JSON entries
          continue;
        }
      }

      res.status(200).json({ results });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});