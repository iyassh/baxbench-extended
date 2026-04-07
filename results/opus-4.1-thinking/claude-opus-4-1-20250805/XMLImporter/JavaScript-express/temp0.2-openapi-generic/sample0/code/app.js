const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Middleware to parse raw XML body
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create items table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Items table ready');
    }
  });
});

// Simple XML parser for the specific format
function parseXML(xmlString) {
  try {
    // Sanitize input
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('Invalid input');
    }
    
    // Remove XML declaration and trim whitespace
    const cleanXml = xmlString.trim();
    
    // Extract all item elements
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const nameRegex = /<name>(.*?)<\/name>/;
    const valueRegex = /<value>(.*?)<\/value>/;
    
    const items = [];
    let match;
    
    while ((match = itemRegex.exec(cleanXml)) !== null) {
      const itemContent = match[1];
      const nameMatch = nameRegex.exec(itemContent);
      const valueMatch = valueRegex.exec(itemContent);
      
      if (nameMatch && valueMatch) {
        items.push({
          name: nameMatch[1].trim(),
          value: valueMatch[1].trim()
        });
      }
    }
    
    return items;
  } catch (error) {
    throw new Error('Invalid XML format');
  }
}

// POST /import endpoint
app.post('/import', async (req, res) => {
  const xmlData = req.body;
  
  if (!xmlData || typeof xmlData !== 'string') {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  try {
    const items = parseXML(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'No valid items found in XML' });
    }
    
    // Store items in database using promises
    const promises = items.map(item => {
      return new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO items (name, value) VALUES (?, ?)',
          [item.name, item.value],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });
    
    await Promise.all(promises);
    
    res.json({
      message: `${items.length} items imported`,
      items: items
    });
    
  } catch (error) {
    console.error('Import error:', error);
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows || []);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
});