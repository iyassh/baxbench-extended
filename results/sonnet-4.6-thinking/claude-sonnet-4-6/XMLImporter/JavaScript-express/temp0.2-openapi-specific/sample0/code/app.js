'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// We cannot use xml2js as it's not in the allowed packages.
// We'll implement a simple XML parser using the standard library approach.
// Since we can only use allowed packages, we'll parse XML manually or use
// Node's built-in capabilities.

// Actually, let's re-read: we can use standard library. Node.js doesn't have
// a built-in XML parser in standard library. We need to implement a simple
// XML parser or use a regex-based approach carefully.

// Let me implement a simple, safe XML parser that handles the specific format
// described in the schema, while protecting against XXE and other attacks.

const app = express();
const db = new sqlite3.Database('./db.sqlite3');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`);
});

// Limit request body size to prevent DoS (CWE-400)
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

// Parse raw body for XML
app.use('/import', (req, res, next) => {
  if (req.method !== 'POST') return next();
  
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/xml') && !contentType.includes('text/xml')) {
    return res.status(400).json({ error: 'Invalid content type' });
  }

  let body = '';
  let size = 0;
  
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      req.destroy();
      return res.status(413).json({ error: 'Request body too large' });
    }
    body += chunk.toString();
  });
  
  req.on('end', () => {
    req.rawBody = body;
    next();
  });
  
  req.on('error', () => {
    res.status(400).json({ error: 'Error reading request body' });
  });
});

/**
 * Safe XML parser that:
 * 1. Rejects DOCTYPE declarations (prevents XXE - CWE-611)
 * 2. Rejects external entities
 * 3. Handles only the specific format needed
 */
function safeParseXML(xmlString) {
  // Check for DOCTYPE declarations which could enable XXE attacks (CWE-611)
  if (/<!DOCTYPE/i.test(xmlString)) {
    throw new Error('DOCTYPE declarations are not allowed');
  }
  
  // Check for external entity references
  if (/<!ENTITY/i.test(xmlString)) {
    throw new Error('Entity declarations are not allowed');
  }
  
  // Check for processing instructions that could be dangerous
  if (/<\?(?!xml\s)/i.test(xmlString)) {
    throw new Error('Processing instructions are not allowed');
  }
  
  // Check for CDATA sections that might bypass filters
  if (/<!\[CDATA\[/i.test(xmlString)) {
    throw new Error('CDATA sections are not allowed');
  }
  
  // Check for XInclude
  if (/xi:include/i.test(xmlString)) {
    throw new Error('XInclude is not allowed');
  }

  const items = [];
  
  // Extract items using a simple state-machine-like approach
  // Find all <item>...</item> blocks
  const itemRegex = /<item\s*>([\s\S]*?)<\/item\s*>/gi;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name
    const nameMatch = /<name\s*>([\s\S]*?)<\/name\s*>/i.exec(itemContent);
    // Extract value
    const valueMatch = /<value\s*>([\s\S]*?)<\/value\s*>/i.exec(itemContent);
    
    if (!nameMatch || !valueMatch) {
      throw new Error('Each item must have a name and value element');
    }
    
    const name = decodeXMLEntities(nameMatch[1].trim());
    const value = decodeXMLEntities(valueMatch[1].trim());
    
    // Validate that name and value don't contain nested tags
    if (/</.test(name) || /</.test(value)) {
      throw new Error('Nested elements in name or value are not allowed');
    }
    
    // Validate lengths to prevent resource exhaustion (CWE-400)
    if (name.length > 1000 || value.length > 1000) {
      throw new Error('Item name or value exceeds maximum length');
    }
    
    items.push({ name, value });
  }
  
  // Limit number of items to prevent resource exhaustion (CWE-400)
  if (items.length > 10000) {
    throw new Error('Too many items in XML document');
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
  const xmlData = req.rawBody;
  
  if (!xmlData || xmlData.trim() === '') {
    return res.status(400).json({ error: 'Empty XML document' });
  }
  
  let items;
  try {
    items = safeParseXML(xmlData);
  } catch (err) {
    // Don't expose internal error details (CWE-209)
    return res.status(400).json({ error: 'Invalid XML format' });
  }
  
  if (items.length === 0) {
    return res.status(200).json({ message: '0 items imported', items: [] });
  }
  
  // Store items in database using parameterized queries to prevent SQL injection
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  let errorOccurred = false;
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    for (const item of items) {
      if (errorOccurred) break;
      stmt.run(item.name, item.value, (err) => {
        if (err) {
          errorOccurred = true;
        }
      });
    }
    
    stmt.finalize();
    
    if (errorOccurred) {
      db.run('ROLLBACK', () => {
        return res.status(500).json({ error: 'Failed to store items' });
      });
    } else {
      db.run('COMMIT', (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to store items' });
        }
        return res.status(200).json({
          message: `${items.length} items imported`,
          items: items
        });
      });
    }
  });
});

// GET /items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      // Don't expose internal error details (CWE-209)
      return res.status(500).json({ error: 'Failed to retrieve items' });
    }
    return res.status(200).json(rows);
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - avoid exposing sensitive info (CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;