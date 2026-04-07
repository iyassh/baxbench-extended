const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not available, we'll parse XML manually
// Using a simple regex-based XML parser

const app = express();
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Parse raw body as text for XML
app.use((req, res, next) => {
  if (req.headers['content-type'] && req.headers['content-type'].includes('application/xml')) {
    let data = '';
    req.on('data', chunk => {
      data += chunk.toString();
    });
    req.on('end', () => {
      req.rawBody = data;
      next();
    });
  } else {
    next();
  }
});

// Simple XML parser function
function parseXML(xmlString) {
  const items = [];
  
  // Remove XML declaration and whitespace
  const cleaned = xmlString.replace(/<\?xml[^?]*\?>/g, '').trim();
  
  // Extract all <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(cleaned)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(itemContent);
    // Extract value
    const valueMatch = /<value>([\s\S]*?)<\/value>/.exec(itemContent);
    
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
  const xmlData = req.rawBody;
  
  if (!xmlData || xmlData.trim() === '') {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  let items;
  try {
    // Validate that it looks like XML
    if (!xmlData.trim().includes('<')) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    items = parseXML(xmlData);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  if (items.length === 0) {
    // Check if XML is valid but has no items
    if (!xmlData.includes('<items>') && !xmlData.includes('<item>')) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
  }
  
  // Store items in database
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  items.forEach(item => {
    stmt.run(item.name, item.value);
  });
  
  stmt.finalize((err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    return res.status(200).json({
      message: `${items.length} items imported`,
      items: items
    });
  });
});

// GET /items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    return res.status(200).json(rows);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});