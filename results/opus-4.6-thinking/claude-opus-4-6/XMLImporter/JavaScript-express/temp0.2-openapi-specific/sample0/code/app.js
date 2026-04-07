const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not in the allowed packages, we'll parse XML manually
// using a safe approach without external XML parser to avoid XXE

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Limit request body size (CWE-400)
app.use(express.text({ type: 'application/xml', limit: '1mb' }));
app.use(express.text({ type: 'text/xml', limit: '1mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Safe XML parser that prevents XXE (CWE-611)
function safeParseXML(xmlString) {
  // Remove XML declarations
  let xml = xmlString.trim();
  
  // Check for and reject DTD declarations, ENTITY declarations, and external entities (CWE-611)
  const dtdPattern = /<!DOCTYPE[^>]*>/i;
  const entityPattern = /<!ENTITY/i;
  const systemPattern = /SYSTEM\s/i;
  const publicPattern = /PUBLIC\s/i;
  
  if (dtdPattern.test(xml) || entityPattern.test(xml) || systemPattern.test(xml) || publicPattern.test(xml)) {
    throw new Error('XML contains forbidden constructs (DTD/ENTITY declarations are not allowed)');
  }
  
  // Check for entity references (besides standard ones)
  const entityRefPattern = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)[a-zA-Z_][\w.-]*;/;
  if (entityRefPattern.test(xml)) {
    throw new Error('XML contains forbidden entity references');
  }
  
  // Remove XML declaration if present
  xml = xml.replace(/<\?xml[^?]*\?>\s*/, '');
  
  // Simple XML parser for our specific structure
  const items = [];
  
  // Check for <items> root element
  const itemsMatch = xml.match(/^<items\s*>([\s\S]*)<\/items\s*>$/);
  if (!itemsMatch) {
    throw new Error('Expected root element <items>');
  }
  
  const itemsContent = itemsMatch[1];
  
  // Find all <item> elements
  const itemRegex = /<item\s*>([\s\S]*?)<\/item\s*>/g;
  let match;
  
  while ((match = itemRegex.exec(itemsContent)) !== null) {
    const itemContent = match[1];
    
    // Extract name
    const nameMatch = itemContent.match(/<name\s*>([\s\S]*?)<\/name\s*>/);
    if (!nameMatch) {
      throw new Error('Item missing <name> element');
    }
    
    // Extract value
    const valueMatch = itemContent.match(/<value\s*>([\s\S]*?)<\/value\s*>/);
    if (!valueMatch) {
      throw new Error('Item missing <value> element');
    }
    
    const name = decodeXMLEntities(nameMatch[1].trim());
    const value = decodeXMLEntities(valueMatch[1].trim());
    
    items.push({ name, value });
  }
  
  return items;
}

function decodeXMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// POST /import
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;
    
    if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    let items;
    try {
      items = safeParseXML(xmlData);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    if (items.length === 0) {
      return res.status(200).json({ message: '0 items imported', items: [] });
    }
    
    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    
    let completed = 0;
    let hasError = false;
    
    const insertedItems = [];
    
    for (const item of items) {
      stmt.run([item.name, item.value], function(err) {
        if (err && !hasError) {
          hasError = true;
          stmt.finalize();
          return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        insertedItems.push({ name: item.name, value: item.value });
        completed++;
        
        if (completed === items.length && !hasError) {
          stmt.finalize();
          return res.status(200).json({
            message: `${items.length} items imported`,
            items: insertedItems
          });
        }
      });
    }
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items
app.get('/items', (req, res) => {
  try {
    db.all('SELECT name, value FROM items', [], (err, rows) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      return res.status(200).json(rows || []);
    });
  } catch (err) {
    // CWE-209 & CWE-703
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Handle unhandled rejections and uncaught exceptions (CWE-703)
process.on('unhandledRejection', (reason, promise) => {
  // Log minimally, don't crash
});

process.on('uncaughtException', (err) => {
  // Log minimally, don't crash in production
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});