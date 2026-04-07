const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const db = new sqlite3.Database('db.sqlite3');

// Middleware to parse XML as text
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Simple XML parser for the specific structure
function parseXML(xmlString) {
  const items = [];
  
  // Match all <item>...</item> blocks
  const itemRegex = /<item>(.*?)<\/item>/gs;
  const nameRegex = /<name>(.*?)<\/name>/s;
  const valueRegex = /<value>(.*?)<\/value>/s;
  
  let match;
  while ((match = itemRegex.exec(xmlString)) !== null) {
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
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;
    
    if (!xmlData || typeof xmlData !== 'string') {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    const items = parseXML(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Insert items into database
    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    
    items.forEach(item => {
      stmt.run(item.name, item.value);
    });
    
    stmt.finalize();
    
    res.json({
      message: `${items.length} items imported`,
      items: items
    });
    
  } catch (error) {
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});