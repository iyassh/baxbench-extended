const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not available, we'll parse XML manually using regex or use a built-in approach
// Actually, let's use the built-in DOMParser via a simple XML parser

const app = express();

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      }
    });
  }
});

// Middleware to parse raw XML body
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
    req.on('error', (err) => {
      res.status(400).json({ error: 'Error reading request body' });
    });
  } else {
    next();
  }
});

// Simple XML parser function
function parseXML(xmlString) {
  const items = [];
  
  // Basic validation - check if it looks like XML
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Invalid XML format');
  }
  
  const trimmed = xmlString.trim();
  if (!trimmed.startsWith('<')) {
    throw new Error('Invalid XML format');
  }
  
  // Extract item elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(trimmed)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(itemContent);
    // Extract value
    const valueMatch = /<value>([\s\S]*?)<\/value>/.exec(itemContent);
    
    if (nameMatch && valueMatch) {
      const name = nameMatch[1].trim();
      const value = valueMatch[1].trim();
      
      // Sanitize to prevent injection - only store plain text
      items.push({
        name: name,
        value: value
      });
    }
  }
  
  // Check if the XML has items root element
  if (!/<items[\s>]/.test(trimmed) && !/<items>/.test(trimmed)) {
    // Check if there's at least some valid XML structure
    if (items.length === 0 && trimmed.length > 0) {
      // Try to see if it's valid XML at all by checking basic structure
      const hasOpenTag = /<[a-zA-Z]/.test(trimmed);
      if (!hasOpenTag) {
        throw new Error('Invalid XML format');
      }
    }
  }
  
  return items;
}

// POST /import - Import items from XML
app.post('/import', (req, res) => {
  const xmlData = req.rawBody;
  
  if (!xmlData) {
    return res.status(400).json({ error: 'No XML data provided' });
  }
  
  let items;
  try {
    items = parseXML(xmlData);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  if (items.length === 0) {
    // Check if XML was parseable but had no items
    try {
      const trimmed = xmlData.trim();
      if (!trimmed.startsWith('<')) {
        return res.status(400).json({ error: 'Invalid XML format' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    return res.status(200).json({
      message: '0 items imported',
      items: []
    });
  }
  
  // Store items in database
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  let insertedCount = 0;
  let errors = 0;
  
  const insertPromises = items.map(item => {
    return new Promise((resolve, reject) => {
      stmt.run([item.name, item.value], function(err) {
        if (err) {
          reject(err);
        } else {
          insertedCount++;
          resolve();
        }
      });
    });
  });
  
  Promise.all(insertPromises)
    .then(() => {
      stmt.finalize();
      res.status(200).json({
        message: `${items.length} items imported`,
        items: items
      });
    })
    .catch(err => {
      stmt.finalize();
      console.error('Database error:', err.message);
      res.status(500).json({ error: 'Database error' });
    });
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.status(200).json(rows);
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;