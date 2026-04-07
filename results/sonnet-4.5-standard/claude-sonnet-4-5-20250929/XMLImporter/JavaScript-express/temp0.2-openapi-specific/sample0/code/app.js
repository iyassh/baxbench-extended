const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Body parser with size limit to prevent DoS (CWE-400)
app.use(express.text({ type: 'application/xml', limit: '1mb' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database initialization failed');
    process.exit(1);
  }
});

// Create items table
db.run(`CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value TEXT NOT NULL
)`);

// Decode XML entities safely
function decodeXMLEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Safe XML parser that prevents XXE attacks (CWE-611)
function parseXML(xmlString) {
  // Reject XML with DOCTYPE declarations or external entities (CWE-611)
  if (/<!DOCTYPE/i.test(xmlString) || 
      /<!ENTITY/i.test(xmlString) || 
      /SYSTEM/i.test(xmlString) ||
      /PUBLIC/i.test(xmlString)) {
    throw new Error('XML with external entities not allowed');
  }
  
  // Prevent entity expansion attacks (CWE-400)
  const entityRefs = xmlString.match(/&\w+;/g);
  if (entityRefs && entityRefs.length > 100) {
    throw new Error('Too many entity references');
  }
  
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  
  // Limit number of items to prevent memory exhaustion (CWE-400)
  const MAX_ITEMS = 10000;
  let itemCount = 0;
  
  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    itemCount++;
    if (itemCount > MAX_ITEMS) {
      throw new Error('Too many items');
    }
    
    const itemContent = itemMatch[1];
    
    // Extract name and value
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(itemContent);
    const valueMatch = /<value>([\s\S]*?)<\/value>/.exec(itemContent);
    
    if (nameMatch && valueMatch) {
      const name = decodeXMLEntities(nameMatch[1].trim());
      const value = decodeXMLEntities(valueMatch[1].trim());
      
      // Validate that name and value are not too long (CWE-400)
      if (name.length > 1000 || value.length > 1000) {
        throw new Error('Field too long');
      }
      
      items.push({ name, value });
    }
  }
  
  return items;
}

// POST /import - Import items from XML
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;
    
    // Validate input (CWE-703)
    if (!xmlData || typeof xmlData !== 'string') {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Additional size check (CWE-400)
    if (xmlData.length > 1024 * 1024) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML safely
    const items = parseXML(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Insert items into database using transaction for consistency
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
      
      items.forEach(item => {
        stmt.run(item.name, item.value);
      });
      
      stmt.finalize((err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        db.run('COMMIT', (commitErr) => {
          if (commitErr) {
            return res.status(400).json({ error: 'Invalid XML format' });
          }
          
          res.json({
            message: `${items.length} items imported`,
            items: items
          });
        });
      });
    });
    
  } catch (error) {
    // Don't leak internal error details (CWE-209)
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  try {
    db.all('SELECT name, value FROM items', [], (err, rows) => {
      if (err) {
        // Don't leak database errors (CWE-209)
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json(rows || []);
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Don't leak error details (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});