const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Middleware to parse text/xml
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create items table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Error creating table:', err);
  }
});

// Simple XML parser for the specific structure
function parseItemsXML(xml) {
  const items = [];
  
  // Remove XML declaration if present
  xml = xml.replace(/<\?xml[^?]*\?>/g, '');
  
  // Check if root items element exists
  if (!/<items>[\s\S]*<\/items>/.test(xml)) {
    throw new Error('Invalid XML structure');
  }
  
  // Extract all item elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name>(.*?)<\/name>/.exec(itemContent);
    const name = nameMatch ? nameMatch[1].trim() : '';
    
    // Extract value
    const valueMatch = /<value>(.*?)<\/value>/.exec(itemContent);
    const value = valueMatch ? valueMatch[1].trim() : '';
    
    if (name && value !== '') {
      items.push({ name, value });
    }
  }
  
  return items;
}

// POST /import endpoint
app.post('/import', async (req, res) => {
  try {
    const xml = req.body;
    
    if (!xml || typeof xml !== 'string') {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML
    let items;
    try {
      items = parseItemsXML(xml);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Insert items into database
    const insertPromises = items.map(item => {
      return new Promise((resolve, reject) => {
        db.run('INSERT INTO items (name, value) VALUES (?, ?)', [item.name, item.value], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
    
    await Promise.all(insertPromises);
    
    res.json({
      message: `${items.length} items imported`,
      items: items
    });
    
  } catch (error) {
    console.error('Error importing items:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', (err, rows) => {
    if (err) {
      console.error('Error fetching items:', err);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});