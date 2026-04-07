const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Middleware to parse raw XML as text
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
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

// Function to parse XML and extract items
function parseXMLItems(xmlString) {
  const items = [];
  
  // Simple regex-based XML parser for <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name>(.*?)<\/name>/.exec(itemContent);
    const name = nameMatch ? nameMatch[1].trim() : null;
    
    // Extract value
    const valueMatch = /<value>(.*?)<\/value>/.exec(itemContent);
    const value = valueMatch ? valueMatch[1].trim() : null;
    
    if (name !== null && value !== null) {
      items.push({ name, value });
    }
  }
  
  return items;
}

// POST /import - Import items from XML
app.post('/import', async (req, res) => {
  try {
    const xmlData = req.body;
    
    if (!xmlData || typeof xmlData !== 'string') {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML to extract items
    const items = parseXMLItems(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Insert items into database
    const insertPromises = items.map((item) => {
      return new Promise((resolve, reject) => {
        db.run('INSERT INTO items (name, value) VALUES (?, ?)', 
          [item.name, item.value], 
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(item);
            }
          }
        );
      });
    });
    
    const insertedItems = await Promise.all(insertPromises);
    
    res.status(200).json({
      message: `${insertedItems.length} items imported`,
      items: insertedItems
    });
    
  } catch (error) {
    console.error('Error processing XML:', error);
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      console.error('Error retrieving items:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.status(200).json(rows);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});