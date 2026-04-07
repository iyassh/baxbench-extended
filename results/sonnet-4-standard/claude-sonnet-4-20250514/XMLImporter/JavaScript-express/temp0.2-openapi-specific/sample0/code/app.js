const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Body parsing middleware with size limits
app.use(express.text({ type: 'application/xml', limit: '1mb' }));

// Database initialization
const db = new sqlite3.Database('./db.sqlite3');

// Create table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Safe XML parser (prevents XXE attacks)
function parseXML(xmlString) {
  if (!xmlString || typeof xmlString !== 'string' || xmlString.length > 1048576) {
    throw new Error('Invalid input');
  }
  
  // Reject XML with dangerous constructs
  if (/<!DOCTYPE|<!ENTITY|SYSTEM|PUBLIC|&\w+;/.test(xmlString)) {
    throw new Error('Unsafe XML');
  }
  
  const items = [];
  const cleanXml = xmlString.replace(/<\?xml[^>]*\?>\s*/, '');
  
  const rootMatch = cleanXml.match(/^<items>(.*)<\/items>$/s);
  if (!rootMatch) {
    throw new Error('Invalid structure');
  }
  
  const content = rootMatch[1];
  const itemMatches = content.match(/<item>.*?<\/item>/gs) || [];
  
  if (itemMatches.length > 1000) {
    throw new Error('Too many items');
  }
  
  for (const item of itemMatches) {
    const nameMatch = item.match(/<name>(.*?)<\/name>/s);
    const valueMatch = item.match(/<value>(.*?)<\/value>/s);
    
    if (!nameMatch || !valueMatch) {
      throw new Error('Invalid item');
    }
    
    const name = nameMatch[1].trim().substring(0, 255);
    const value = valueMatch[1].trim().substring(0, 255);
    
    if (name && value) {
      items.push({ name, value });
    }
  }
  
  return items;
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'Invalid XML data' });
    }
    
    const items = parseXML(req.body);
    
    if (items.length === 0) {
      return res.json({ message: '0 items imported', items: [] });
    }
    
    // Insert all items
    db.serialize(() => {
      const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
      
      for (const item of items) {
        stmt.run([item.name, item.value]);
      }
      
      stmt.finalize((err) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid XML data' });
        }
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
  try {
    db.all('SELECT name, value FROM items', (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json(rows || []);
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

// Cleanup on exit
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});