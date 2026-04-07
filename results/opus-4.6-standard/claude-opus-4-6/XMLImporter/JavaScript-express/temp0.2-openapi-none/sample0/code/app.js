const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

const app = express();

// We need to parse raw XML body
app.use(express.raw({ type: 'application/xml', limit: '10mb' }));
app.use(express.text({ type: 'application/xml', limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Simple XML parser without xml2js dependency
function parseXML(xmlString) {
  // Extract items from XML using regex-based parsing
  const items = [];
  
  // Check for basic XML validity
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Invalid XML format');
  }

  // Check if there's an <items> root element
  const itemsMatch = xmlString.match(/<items\s*>([\s\S]*?)<\/items>/);
  if (!itemsMatch) {
    throw new Error('Invalid XML format');
  }

  const itemsContent = itemsMatch[1];
  
  // Find all <item> elements
  const itemRegex = /<item\s*>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(itemsContent)) !== null) {
    const itemContent = match[1];
    
    const nameMatch = itemContent.match(/<name\s*>([\s\S]*?)<\/name>/);
    const valueMatch = itemContent.match(/<value\s*>([\s\S]*?)<\/value>/);
    
    if (nameMatch && valueMatch) {
      items.push({
        name: nameMatch[1].trim(),
        value: valueMatch[1].trim()
      });
    }
  }
  
  return items;
}

// POST /import
app.post('/import', (req, res) => {
  try {
    let xmlString;
    if (Buffer.isBuffer(req.body)) {
      xmlString = req.body.toString('utf-8');
    } else if (typeof req.body === 'string') {
      xmlString = req.body;
    } else {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    if (!xmlString || xmlString.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    let items;
    try {
      items = parseXML(xmlString);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    if (items.length === 0) {
      return res.json({ message: '0 items imported', items: [] });
    }

    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    const importedItems = [];

    let completed = 0;
    let hasError = false;

    items.forEach((item) => {
      stmt.run(item.name, item.value, (err) => {
        if (err && !hasError) {
          hasError = true;
          return res.status(400).json({ error: 'Failed to store items' });
        }
        importedItems.push({ name: item.name, value: item.value });
        completed++;
        if (completed === items.length && !hasError) {
          stmt.finalize();
          res.json({
            message: `${items.length} items imported`,
            items: importedItems
          });
        }
      });
    });
  } catch (e) {
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows || []);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});