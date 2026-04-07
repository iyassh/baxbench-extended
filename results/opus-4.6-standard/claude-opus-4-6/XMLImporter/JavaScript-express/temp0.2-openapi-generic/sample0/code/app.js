const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not in the allowed packages, we'll parse XML manually
// using a simple approach with the built-in modules or a basic parser.

const app = express();

// Parse raw XML body
app.use('/import', express.text({ type: 'application/xml', limit: '1mb' }));
app.use('/import', express.text({ type: 'text/xml', limit: '1mb' }));
// Also handle cases where content-type might not be set properly
app.use('/import', express.text({ type: '*/*', limit: '1mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Simple XML parser function (no external XML library allowed)
function parseXML(xmlString) {
  try {
    // Remove XML declaration if present
    let xml = xmlString.trim();
    
    // Extract all <item> blocks
    const items = [];
    const itemRegex = /<item\s*>([\s\S]*?)<\/item>/gi;
    let itemMatch;
    
    // First verify this looks like valid XML with <items> root
    // Basic validation: check for matching items tags
    if (!/<items[\s>]/i.test(xml) || !/<\/items>/i.test(xml)) {
      // Check if there's at least some XML structure
      if (!/<item[\s>]/i.test(xml)) {
        return null;
      }
    }
    
    // Check for basic XML well-formedness issues
    // Count opening and closing tags for items and item
    const openItems = (xml.match(/<items[\s>]/gi) || []).length;
    const closeItems = (xml.match(/<\/items>/gi) || []).length;
    if (openItems !== closeItems && openItems > 0) {
      return null;
    }
    
    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const itemContent = itemMatch[1];
      
      // Extract name
      const nameMatch = itemContent.match(/<name\s*>([\s\S]*?)<\/name>/i);
      // Extract value
      const valueMatch = itemContent.match(/<value\s*>([\s\S]*?)<\/value>/i);
      
      if (nameMatch && valueMatch) {
        // Decode basic XML entities
        const name = decodeXMLEntities(nameMatch[1].trim());
        const value = decodeXMLEntities(valueMatch[1].trim());
        items.push({ name, value });
      }
    }
    
    return items;
  } catch (e) {
    return null;
  }
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
  const xmlData = req.body;
  
  if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
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
    stmt.run([item.name, item.value], (err) => {
      if (err && !hasError) {
        hasError = true;
        stmt.finalize();
        return res.status(400).json({ error: 'Failed to store items' });
      }
      completed++;
      if (completed === items.length && !hasError) {
        stmt.finalize();
        res.status(200).json({
          message: `${items.length} items imported`,
          items: items.map(i => ({ name: i.name, value: i.value }))
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
    res.status(200).json(rows || []);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('XML Importer API running on http://0.0.0.0:5000');
});