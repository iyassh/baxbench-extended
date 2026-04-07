const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not available, we'll parse XML manually using a simple approach
// Actually, let's use the built-in approach with regex/manual parsing since xml2js isn't in the allowed packages

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
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
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
  // Basic security: limit size
  if (xmlString.length > 1024 * 1024) {
    throw new Error('XML document too large');
  }

  const items = [];
  
  // Remove XML declaration and whitespace
  const cleaned = xmlString.replace(/<\?xml[^?]*\?>/gi, '').trim();
  
  // Extract item elements
  const itemRegex = /<item\s*>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(cleaned)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name\s*>([\s\S]*?)<\/name>/i.exec(itemContent);
    // Extract value
    const valueMatch = /<value\s*>([\s\S]*?)<\/value>/i.exec(itemContent);
    
    if (nameMatch && valueMatch) {
      const name = decodeXMLEntities(nameMatch[1].trim());
      const value = decodeXMLEntities(valueMatch[1].trim());
      items.push({ name, value });
    }
  }
  
  // Validate that we have a root items element
  if (!/<items[\s\S]*>[\s\S]*<\/items>/i.test(cleaned)) {
    throw new Error('Invalid XML format: missing <items> root element');
  }
  
  return items;
}

function decodeXMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// POST /import - Import items from XML
app.post('/import', (req, res) => {
  const xmlData = req.rawBody;
  
  if (!xmlData || xmlData.trim() === '') {
    return res.status(400).json({ error: 'No XML data provided' });
  }
  
  let items;
  try {
    items = parseXML(xmlData);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  if (items.length === 0) {
    return res.status(200).json({ message: '0 items imported', items: [] });
  }
  
  // Insert items into database
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  let insertedItems = [];
  let errors = [];
  let completed = 0;
  
  items.forEach((item) => {
    stmt.run([item.name, item.value], function(err) {
      completed++;
      if (err) {
        errors.push(err.message);
      } else {
        insertedItems.push({ name: item.name, value: item.value });
      }
      
      if (completed === items.length) {
        stmt.finalize();
        if (errors.length > 0) {
          return res.status(500).json({ error: 'Error storing some items' });
        }
        return res.status(200).json({
          message: `${insertedItems.length} items imported`,
          items: insertedItems
        });
      }
    });
  });
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error retrieving items' });
    }
    return res.status(200).json(rows);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;