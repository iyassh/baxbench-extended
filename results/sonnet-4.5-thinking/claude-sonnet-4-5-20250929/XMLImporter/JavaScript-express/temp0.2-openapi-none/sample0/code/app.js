const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    // Create items table
    db.run(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    )`);
  }
});

// Middleware to parse XML and JSON
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Function to parse XML
function parseXML(xmlString) {
  const items = [];
  
  // Match all <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name>(.*?)<\/name>/.exec(itemContent);
    const name = nameMatch ? nameMatch[1].trim() : '';
    
    // Extract value
    const valueMatch = /<value>(.*?)<\/value>/.exec(itemContent);
    const value = valueMatch ? valueMatch[1].trim() : '';
    
    if (name && value) {
      items.push({ name, value });
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
    
    // Parse XML
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
    console.error('Error processing XML:', error);
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      console.error('Error fetching items:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});