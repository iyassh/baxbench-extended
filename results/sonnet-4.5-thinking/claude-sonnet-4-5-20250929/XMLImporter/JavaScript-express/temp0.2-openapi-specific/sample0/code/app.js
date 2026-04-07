const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Constants for resource limits (CWE-400)
const MAX_XML_SIZE = 1024 * 1024; // 1MB
const MAX_ITEMS_PER_IMPORT = 1000;
const MAX_FIELD_LENGTH = 10000;

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Limit request size to prevent resource exhaustion (CWE-400)
app.use(express.text({ 
  type: 'application/xml', 
  limit: '1mb' 
}));

app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create table
db.run(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )
`);

// Decode only standard XML entities
function decodeXMLEntities(str) {
  // Important: decode &amp; last to avoid issues with other entities
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Simple and secure XML parser for the specific schema
function parseXML(xmlString) {
  // Security checks for CWE-611 (XXE attacks)
  
  // Check for DOCTYPE declarations
  if (/<!DOCTYPE/i.test(xmlString)) {
    throw new Error('Invalid XML');
  }
  
  // Check for entity declarations
  if (/<!ENTITY/i.test(xmlString)) {
    throw new Error('Invalid XML');
  }
  
  // Check for external references
  if (/SYSTEM|PUBLIC/i.test(xmlString)) {
    throw new Error('Invalid XML');
  }
  
  const items = [];
  
  // Extract all <item> elements
  const itemRegex = /<item>(.*?)<\/item>/gs;
  const itemMatches = [...xmlString.matchAll(itemRegex)];
  
  // Resource limit check (CWE-400)
  if (itemMatches.length > MAX_ITEMS_PER_IMPORT) {
    throw new Error('Invalid XML');
  }
  
  for (const match of itemMatches) {
    const itemContent = match[1];
    
    // Extract name
    const nameMatch = /<name>(.*?)<\/name>/s.exec(itemContent);
    // Extract value
    const valueMatch = /<value>(.*?)<\/value>/s.exec(itemContent);
    
    if (nameMatch && valueMatch) {
      const name = nameMatch[1].trim();
      const value = valueMatch[1].trim();
      
      // Resource limit check (CWE-400)
      if (name.length > MAX_FIELD_LENGTH || value.length > MAX_FIELD_LENGTH) {
        throw new Error('Invalid XML');
      }
      
      // Decode basic XML entities
      const decodeName = decodeXMLEntities(name);
      const decodeValue = decodeXMLEntities(value);
      
      items.push({
        name: decodeName,
        value: decodeValue
      });
    }
  }
  
  return items;
}

// POST /import endpoint
app.post('/import', (req, res) => {
  let items;
  
  try {
    const xmlData = req.body;
    
    if (!xmlData || typeof xmlData !== 'string') {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Resource limit check (CWE-400)
    if (xmlData.length > MAX_XML_SIZE) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML
    items = parseXML(xmlData);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
  } catch (err) {
    // CWE-209: Sanitize error messages
    // CWE-703: Proper exception handling
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  // Insert items into database using a transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    
    for (const item of items) {
      stmt.run([item.name, item.value]);
    }
    
    stmt.finalize((err) => {
      if (err) {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Invalid XML format' });
      }
      
      db.run('COMMIT', (err) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        res.json({
          message: `${items.length} items imported`,
          items: items
        });
      });
    });
  });
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      // CWE-209: Don't expose database errors
      return res.status(500).json({ error: 'Failed to retrieve items' });
    }
    
    res.json(rows || []);
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});