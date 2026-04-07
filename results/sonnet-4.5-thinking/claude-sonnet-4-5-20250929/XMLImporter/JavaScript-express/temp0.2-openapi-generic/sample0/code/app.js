const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware to parse XML (text) body
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
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
  }
});

// Simple XML parser function
function parseXML(xmlString) {
  const items = [];
  
  // Match all <item>...</item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(itemContent);
    const name = nameMatch ? nameMatch[1].trim() : '';
    
    // Extract value
    const valueMatch = /<value>([\s\S]*?)<\/value>/.exec(itemContent);
    const value = valueMatch ? valueMatch[1].trim() : '';
    
    if (name && value) {
      items.push({ name, value });
    }
  }
  
  return items;
}

// POST /import - Import items from XML
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
    
    let insertedCount = 0;
    const insertPromises = [];
    
    items.forEach(item => {
      insertPromises.push(new Promise((resolve, reject) => {
        stmt.run(item.name, item.value, (err) => {
          if (err) {
            reject(err);
          } else {
            insertedCount++;
            resolve();
          }
        });
      }));
    });
    
    Promise.all(insertPromises)
      .then(() => {
        stmt.finalize();
        res.json({
          message: `${insertedCount} items imported`,
          items: items
        });
      })
      .catch(err => {
        stmt.finalize();
        console.error('Database error:', err);
        res.status(400).json({ error: 'Invalid XML format' });
      });
    
  } catch (error) {
    console.error('Error parsing XML:', error);
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.json(rows);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});