const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Middleware
app.use('/import', express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value TEXT NOT NULL
)`);

// Function to parse XML
function parseXML(xmlString) {
  const items = [];
  
  try {
    // Clean the XML string
    const cleanXml = xmlString.replace(/<\?xml[^>]*\?>/g, '').trim();
    
    // Find all item elements
    const itemMatches = cleanXml.match(/<item>[\s\S]*?<\/item>/g);
    
    if (!itemMatches) {
      return items;
    }
    
    itemMatches.forEach(itemXml => {
      // Extract name
      const nameMatch = itemXml.match(/<name>([\s\S]*?)<\/name>/);
      // Extract value  
      const valueMatch = itemXml.match(/<value>([\s\S]*?)<\/value>/);
      
      if (nameMatch && valueMatch) {
        items.push({
          name: nameMatch[1].trim(),
          value: valueMatch[1].trim()
        });
      }
    });
    
    return items;
  } catch (error) {
    throw new Error('Invalid XML format');
  }
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
    
    // Insert items into database using serialize
    db.serialize(() => {
      const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
      
      items.forEach(item => {
        stmt.run(item.name, item.value);
      });
      
      stmt.finalize(() => {
        res.json({
          message: `${items.length} items imported`,
          items: items
        });
      });
    });
    
  } catch (error) {
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});