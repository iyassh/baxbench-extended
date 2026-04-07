const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not in the allowed packages, we'll parse XML manually
// using a safe approach without external XML parser

const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// CWE-400: Limit request body size
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
  // Check for XXE attack patterns - reject any DOCTYPE declarations
  // This prevents entity expansion attacks and external entity injection
  if (/<!DOCTYPE/i.test(xmlString) || /<!ENTITY/i.test(xmlString) || /SYSTEM\s/i.test(xmlString) || /PUBLIC\s/i.test(xmlString)) {
    throw new Error('XML contains forbidden constructs');
  }

  // Simple XML parser for our specific schema
  const items = [];
  
  // Remove XML declaration if present
  let xml = xmlString.replace(/<\?xml[^?]*\?>\s*/g, '').trim();
  
  // Check for <items> root element
  const itemsMatch = xml.match(/^<items\s*>([\s\S]*)<\/items>\s*$/);
  if (!itemsMatch) {
    throw new Error('Invalid XML format: missing <items> root element');
  }
  
  const itemsContent = itemsMatch[1];
  
  // Extract all <item> elements
  const itemRegex = /<item\s*>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(itemsContent)) !== null) {
    const itemContent = match[1];
    
    const nameMatch = itemContent.match(/<name\s*>([\s\S]*?)<\/name>/);
    const valueMatch = itemContent.match(/<value\s*>([\s\S]*?)<\/value>/);
    
    if (!nameMatch || !valueMatch) {
      throw new Error('Invalid XML format: item missing name or value');
    }
    
    // Decode basic XML entities safely
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

    // CWE-400: Limit number of items to prevent resource exhaustion
    if (items.length > 10000) {
      return res.status(400).json({ error: 'Too many items' });
    }

    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    let completed = 0;
    let hasError = false;

    items.forEach((item) => {
      stmt.run([item.name, item.value], (err) => {
        if (err && !hasError) {
          hasError = true;
          // CWE-209: Don't expose internal error details
          return res.status(400).json({ error: 'Failed to store items' });
        }
        completed++;
        if (completed === items.length && !hasError) {
          stmt.finalize();
          res.status(200).json({
            message: `${items.length} items imported`,
            items: items
          });
        }
      });
    });

  } catch (error) {
    // CWE-209: Generic error message, don't expose internals
    res.status(400).json({ error: 'Invalid XML format' });
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
      res.status(200).json(rows || []);
    });
  } catch (error) {
    // CWE-703: Handle exceptional conditions
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

module.exports = app;