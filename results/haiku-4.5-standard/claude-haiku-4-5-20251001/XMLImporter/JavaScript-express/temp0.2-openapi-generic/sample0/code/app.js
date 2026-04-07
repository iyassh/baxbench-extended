const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Create/connect to SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database opening error: ', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Initialize database table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Table creation error:', err);
  });
});

// Middleware to parse XML as text
app.use(express.text({ type: 'application/xml' }));

// Simple XML parser for extracting items
function parseXML(xmlString) {
  const items = [];
  
  try {
    // Validate input
    if (!xmlString || typeof xmlString !== 'string' || !xmlString.includes('<item')) {
      throw new Error('Invalid XML format');
    }
    
    // Remove XML declaration
    let content = xmlString.replace(/<\?xml[^?]*\?>/g, '').trim();
    
    // Validate items root element exists
    if (!/<items[^>]*>/i.test(content)) {
      throw new Error('Invalid XML format');
    }
    
    // Extract all item elements
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let foundItems = false;
    
    while ((match = itemRegex.exec(content)) !== null) {
      foundItems = true;
      const itemContent = match[1];
      
      // Extract name
      const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(itemContent);
      const name = nameMatch ? nameMatch[1].trim() : null;
      
      // Extract value
      const valueMatch = /<value>([\s\S]*?)<\/value>/.exec(itemContent);
      const value = valueMatch ? valueMatch[1].trim() : null;
      
      if (name && value) {
        items.push({ name, value });
      } else {
        throw new Error('Invalid item format');
      }
    }
    
    if (!foundItems) {
      throw new Error('No items found');
    }
    
    return items;
  } catch (error) {
    throw new Error('Invalid XML format');
  }
}

// POST /import endpoint - Parse and store XML items
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;
    
    if (!xmlData) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML
    const items = parseXML(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Store items in database
    let completed = 0;
    let errors = [];
    
    items.forEach((item) => {
      const id = uuidv4();
      db.run(
        'INSERT INTO items (id, name, value) VALUES (?, ?, ?)',
        [id, item.name, item.value],
        function(err) {
          if (err) {
            errors.push(err);
          }
          completed++;
          
          // Send response once all items have been processed
          if (completed === items.length) {
            if (errors.length > 0) {
              res.status(500).json({ error: 'Database error during import' });
            } else {
              res.status(200).json({
                message: `${items.length} items imported`,
                items: items
              });
            }
          }
        }
      );
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint - Return all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.status(200).json(rows || []);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error(err);
    process.exit(0);
  });
});