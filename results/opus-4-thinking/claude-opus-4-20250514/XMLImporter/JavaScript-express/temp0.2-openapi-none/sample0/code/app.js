const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Middleware to parse raw body for XML
app.use(express.raw({ type: 'application/xml' }));

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

// Simple XML parser function
function parseXML(xmlString) {
  const items = [];
  
  try {
    // Remove XML declaration if present
    xmlString = xmlString.replace(/<\?xml[^?]*\?>/gi, '');
    
    // Check if items root element exists
    if (!xmlString.includes('<items>') || !xmlString.includes('</items>')) {
      throw new Error('Invalid XML structure');
    }
    
    // Extract all item elements
    const itemMatches = xmlString.match(/<item>[\s\S]*?<\/item>/g);
    
    if (!itemMatches) {
      return items;
    }
    
    itemMatches.forEach(itemXml => {
      // Extract name
      const nameMatch = itemXml.match(/<name>(.*?)<\/name>/);
      const name = nameMatch ? nameMatch[1].trim() : '';
      
      // Extract value
      const valueMatch = itemXml.match(/<value>(.*?)<\/value>/);
      const value = valueMatch ? valueMatch[1].trim() : '';
      
      if (name && value) {
        items.push({ name, value });
      }
    });
    
    return items;
  } catch (err) {
    throw new Error('XML parsing error');
  }
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    // Get the XML data from request body
    const xmlData = req.body.toString('utf-8');
    
    // Parse XML
    const items = parseXML(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Insert items into database
    const insertPromises = items.map(item => {
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
    
    Promise.all(insertPromises)
      .then(() => {
        res.json({
          message: `${items.length} items imported`,
          items: items
        });
      })
      .catch(err => {
        res.status(500).json({ error: 'Database error' });
      });
    
  } catch (err) {
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Database error' });
      return;
    }
    res.json(rows);
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`XML Importer API listening at http://0.0.0.0:${port}`);
});