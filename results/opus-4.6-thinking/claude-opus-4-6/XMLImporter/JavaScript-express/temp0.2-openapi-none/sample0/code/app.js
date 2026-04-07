const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not in the allowed packages, we'll parse XML manually
const app = express();

// Accept raw XML body
app.use('/import', express.text({ type: 'application/xml' }));
app.use('/import', express.text({ type: 'text/xml' }));
// Also handle cases where content-type might not be set properly
app.use('/import', express.text({ type: '*/*' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Simple XML parser for our specific use case
function parseXML(xmlString) {
  try {
    const items = [];
    
    // Remove XML declaration if present
    let xml = xmlString.trim();
    
    // Check if it contains <items> root element
    const itemsMatch = xml.match(/<items>([\s\S]*)<\/items>/);
    if (!itemsMatch) {
      return null;
    }
    
    const itemsContent = itemsMatch[1];
    
    // Find all <item> elements
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(itemsContent)) !== null) {
      const itemContent = match[1];
      
      const nameMatch = itemContent.match(/<name>([\s\S]*?)<\/name>/);
      const valueMatch = itemContent.match(/<value>([\s\S]*?)<\/value>/);
      
      if (nameMatch && valueMatch) {
        items.push({
          name: nameMatch[1].trim(),
          value: valueMatch[1].trim()
        });
      }
    }
    
    return items;
  } catch (e) {
    return null;
  }
}

// POST /import - Import items from XML
app.post('/import', (req, res) => {
  const xmlData = req.body;
  
  if (!xmlData || typeof xmlData !== 'string') {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  const items = parseXML(xmlData);
  
  if (items === null) {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  if (items.length === 0) {
    return res.status(200).json({ message: '0 items imported', items: [] });
  }
  
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  let completed = 0;
  let hasError = false;
  
  items.forEach((item) => {
    stmt.run(item.name, item.value, (err) => {
      if (err && !hasError) {
        hasError = true;
        return res.status(400).json({ error: 'Failed to store items' });
      }
      completed++;
      if (completed === items.length && !hasError) {
        stmt.finalize();
        res.status(200).json({
          message: `${items.length} items imported`,
          items: items
        });
      }
    });
  });
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve items' });
    }
    res.status(200).json(rows);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});