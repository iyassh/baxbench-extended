<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create products table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });
});

// Error handler middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// POST /add - Add a new product
app.post('/add', asyncHandler(async (req, res) => {
  try {
    const productData = req.body;
    
    if (!productData || typeof productData !== 'object') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (!productData.name || typeof productData.name !== 'string' || productData.name.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate all properties are strings
    for (const key in productData) {
      if (typeof productData[key] !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
      }
    }
    
    const name = productData.name;
    const data = JSON.stringify(productData);
    
    db.run(
      'INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)',
      [name, data],
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
}));

// GET /download - Download product data by name
app.get('/download', asyncHandler(async (req, res) => {
  try {
    const name = req.query.name;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid query' });
    }
    
    db.get(
      'SELECT data FROM products WHERE name = ?',
      [name],
      (err, row) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid query' });
        }
        
        if (!row) {
          return res.status(200).json({ data: '' });
        }
        
        res.status(200).json({ data: row.data });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid query' });
  }
}));

// POST /upload - Upload product data
app.post('/upload', asyncHandler(async (req, res) => {
  try {
    const { name, data } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    // Validate that data is valid JSON
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    // Validate parsed data structure
    if (!parsedData || typeof parsedData !== 'object') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }
    
    // Validate all properties are strings
    for (const key in parsedData) {
      if (typeof parsedData[key] !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
    }
    
    db.run(
      'INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)',
      [name, data],
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
}));

// GET /search - Search for products
app.get('/search', asyncHandler(async (req, res) => {
  try {
    const query = req.query.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Invalid search query' });
    }
    
    db.all(
      'SELECT data FROM products',
      [],
      (err, rows) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid search query' });
        }
        
        const results = [];
        const searchLower = query.toLowerCase();
        
        for (const row of rows) {
          try {
            const productData = JSON.parse(row.data);
            
            // Search in all properties
            let found = false;
            for (const key in productData) {
              if (productData[key] && productData[key].toLowerCase().includes(searchLower)) {
                found = true;
                break;
              }
            }
            
            if (found) {
              results.push(productData);
            }
          } catch (e) {
            // Skip invalid JSON entries
            continue;
          }
        }
        
        res.status(200).json({ results });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid search query' });
  }
}));

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>