const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Middleware to parse raw body for XML
app.use(express.text({ type: 'application/xml', limit: '10mb' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create items table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Simple XML parser for the specific format
function parseItemsXML(xmlString) {
  try {
    // Basic validation
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('Invalid XML format');
    }

    // Basic XML entity decoding
    const decodeEntities = (str) => {
      return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    };

    // Remove XML declaration and normalize whitespace
    const cleanedXml = xmlString
      .replace(/<\?xml[^?]*\?>/i, '')
      .trim();
    
    // Check if root element is <items>
    const rootMatch = cleanedXml.match(/^<items\s*>([\s\S]*)<\/items>$/);
    if (!rootMatch) {
      throw new Error('Invalid XML format');
    }

    const itemsContent = rootMatch[1];
    const items = [];
    
    // Extract all <item> elements
    const itemRegex = /<item\s*>([\s\S]*?)<\/item>/g;
    let itemMatch;
    
    while ((itemMatch = itemRegex.exec(itemsContent)) !== null) {
      const itemContent = itemMatch[1];
      
      // Extract name
      const nameMatch = itemContent.match(/<name\s*>([^<]*)<\/name>/);
      if (!nameMatch) {
        throw new Error('Invalid XML format');
      }
      const name = decodeEntities(nameMatch[1].trim());
      
      // Extract value
      const valueMatch = itemContent.match(/<value\s*>([^<]*)<\/value>/);
      if (!valueMatch) {
        throw new Error('Invalid XML format');
      }
      const value = decodeEntities(valueMatch[1].trim());
      
      // Validate that name and value are not empty
      if (name.length === 0 || value.length === 0) {
        throw new Error('Invalid XML format');
      }
      
      // Limit field lengths for security
      if (name.length > 1000 || value.length > 1000) {
        throw new Error('Invalid XML format');
      }
      
      items.push({ name, value });
    }
    
    return items;
  } catch (error) {
    throw new Error('Invalid XML format');
  }
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;
    
    if (!xmlData) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML
    let items;
    try {
      items = parseItemsXML(xmlData);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Limit number of items to prevent abuse
    if (items.length > 1000) {
      return res.status(400).json({ error: 'Too many items' });
    }
    
    // Begin transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
      
      for (const item of items) {
        stmt.run(item.name, item.value);
      }
      
      stmt.finalize((err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Database error' });
        }
        
        db.run('COMMIT', (commitErr) => {
          if (commitErr) {
            return res.status(500).json({ error: 'Database error' });
          }
          
          res.json({
            message: `${items.length} items imported`,
            items: items
          });
        });
      });
    });
    
  } catch (error) {
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows || []);
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`XML Importer API running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});