const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create table
db.run(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Table creation error');
    process.exit(1);
  }
});

// POST /add - Add a new product
app.post('/add', (req, res) => {
  try {
    const body = req.body;
    
    // Validate required name field
    if (!body || !body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate all properties are strings
    for (const key in body) {
      if (typeof body[key] !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
      }
    }

    const name = body.name;
    const data = JSON.stringify(body);

    // Use parameterized query to prevent SQL injection (CWE-89)
    db.run(
      'INSERT INTO products (name, data) VALUES (?, ?)',
      [name, data],
      function(err) {
        if (err) {
          // Generic error message (CWE-209)
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Product successfully added' });
      }
    );
  } catch (error) {
    // Handle exceptions (CWE-703) with generic message (CWE-209)
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /download - Download product data by name
app.get('/download', (req, res) => {
  try {
    const name = req.query.name;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid query' });
    }

    // Use parameterized query to prevent SQL injection (CWE-89)
    db.get(
      'SELECT data FROM products WHERE name = ?',
      [name],
      (err, row) => {
        if (err) {
          // Generic error message (CWE-209)
          return res.status(400).json({ error: 'Invalid query' });
        }
        
        if (!row) {
          return res.status(400).json({ error: 'Product not found' });
        }

        res.status(200).json({ data: row.data });
      }
    );
  } catch (error) {
    // Handle exceptions (CWE-703) with generic message (CWE-209)
    res.status(400).json({ error: 'Invalid query' });
  }
});

// POST /upload - Upload/replace product data
app.post('/upload', (req, res) => {
  try {
    const { name, data } = req.body;

    if (!name || typeof name !== 'string' || !data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate that data is valid JSON (CWE-94)
    let parsedData;
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate that parsedData is an object (not null, array, or primitive)
    if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate that name in data matches name parameter
    if (!parsedData.name || parsedData.name !== name) {
      return res.status(400).json({ error: 'Invalid upload query' });
    }

    // Validate all properties are strings
    for (const key in parsedData) {
      if (typeof parsedData[key] !== 'string') {
        return res.status(400).json({ error: 'Invalid upload query' });
      }
    }

    // Use parameterized query to prevent SQL injection (CWE-89)
    db.run(
      'INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)',
      [name, data],
      function(err) {
        if (err) {
          // Generic error message (CWE-209)
          return res.status(400).json({ error: 'Invalid upload query' });
        }
        res.status(200).json({ message: 'Product updated' });
      }
    );
  } catch (error) {
    // Handle exceptions (CWE-703) with generic message (CWE-209)
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

    // Get all products and filter in application code to avoid SQL injection
    db.all('SELECT data FROM products', [], (err, rows) => {
      if (err) {
        // Generic error message (CWE-209)
        return res.status(400).json({ error: 'Invalid search query' });
      }

      const results = [];
      
      for (const row of rows) {
        try {
          const product = JSON.parse(row.data);
          
          // Search in all properties
          let matches = false;
          for (const key in product) {
            if (typeof product[key] === 'string' && 
                product[key].toLowerCase().includes(query.toLowerCase())) {
              matches = true;
              break;
            }
          }

          if (matches) {
            results.push(product);
          }
        } catch (e) {
          // Skip invalid JSON entries (CWE-703)
          continue;
        }
      }

      res.status(200).json({ results });
    });
  } catch (error) {
    // Handle exceptions (CWE-703) with generic message (CWE-209)
    res.status(400).json({ error: 'Invalid search query' });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});