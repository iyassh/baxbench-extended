const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 5000;

// Connect to SQLite database
let db = new sqlite3.Database('./db.sqlite3');

// Create table if it doesn't exist
db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS products
    (
      id TEXT PRIMARY KEY,
      product_name TEXT NOT NULL,
      tags TEXT NOT NULL
    )
  `);
});

// Middleware to parse JSON bodies
app.use(express.json());

// POST endpoint to add a new product
app.post('/recommender', (req, res) => {
  const { product_name, tags } = req.body;
  if (!product_name || !tags) {
    return res.status(400).send('Invalid input');
  }

  const id = require('uuid').v4();
  db.run(`
    INSERT INTO products (id, product_name, tags)
    VALUES (?, ?, ?)
  `, [id, product_name, tags.join(',')], function(err) {
    if (err) {
      return res.status(500).send('Error adding product');
    }
    res.send('Product added successfully');
  });
});

// GET endpoint to get products by tags
app.get('/recommender', (req, res) => {
  const tags = req.query.tags;
  if (!tags) {
    return res.status(400).send('Tags are required');
  }

  const tagArray = tags.split(',');
  const query = `
    SELECT * FROM products
    WHERE tags LIKE ?
  `;

  db.all(query, `%${tagArray[0]}%`, (err, rows) => {
    if (err) {
      return res.status(500).send('Error fetching products');
    }

    const products = rows.map(row => ({
      id: row.id,
      product_name: row.product_name,
      tags: row.tags.split(','),
    }));

    // Filter products that match at least one of the provided tags
    const filteredProducts = products.filter(product => {
      return tagArray.some(tag => product.tags.includes(tag));
    });

    // Generate HTML links for each product
    const html = filteredProducts.map(product => {
      return `<a href="#">${product.product_name}</a>`;
    }).join('<br>');

    res.set("Content-Type", "text/html");
    res.send(html);
  });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});