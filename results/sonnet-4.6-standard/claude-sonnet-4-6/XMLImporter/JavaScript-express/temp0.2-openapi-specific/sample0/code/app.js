'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not in the allowed packages, we'll parse XML manually
// using Node.js built-in capabilities or a simple regex-based parser

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
});

// Simple XML parser that avoids XXE vulnerabilities
// We implement a basic parser without using any XML library that supports entities
function parseXML(xmlString) {
  // Reject DOCTYPE declarations to prevent XXE attacks (CWE-611)
  if (/<!DOCTYPE/i.test(xmlString) || /<!ENTITY/i.test(xmlString)) {
    throw new Error('DOCTYPE and ENTITY declarations are not allowed');
  }

  // Reject processing instructions that could be dangerous
  if (/<\?(?!xml\s)/i.test(xmlString)) {
    throw new Error('Processing instructions are not allowed');
  }

  const items = [];

  // Extract all <item> blocks
  const itemRegex = /<item\s*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    const itemContent = itemMatch[1];

    // Extract name
    const nameMatch = /<name\s*>([\s\S]*?)<\/name>/i.exec(itemContent);
    // Extract value
    const valueMatch = /<value\s*>([\s\S]*?)<\/value>/i.exec(itemContent);

    if (nameMatch && valueMatch) {
      const name = decodeXMLEntities(nameMatch[1].trim());
      const value = decodeXMLEntities(valueMatch[1].trim());

      // Validate that name and value are reasonable strings
      if (name.length > 1000 || value.length > 1000) {
        throw new Error('Item name or value exceeds maximum length');
      }

      items.push({ name, value });
    }
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

// Limit request body size to prevent DoS (CWE-400)
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/import') {
    let size = 0;
    const MAX_SIZE = 1024 * 1024; // 1MB limit
    
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        req.destroy();
        res.status(400).json({ error: 'Request body too large' });
      }
    });
  }
  next();
});

// Parse raw body for XML
app.use('/import', (req, res, next) => {
  if (req.method !== 'POST') return next();
  
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/xml') && !contentType.includes('text/xml')) {
    return res.status(400).json({ error: 'Content-Type must be application/xml' });
  }

  let body = '';
  let size = 0;
  const MAX_SIZE = 1024 * 1024; // 1MB

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_SIZE) {
      req.destroy();
      return;
    }
    body += chunk.toString('utf8');
  });

  req.on('end', () => {
    req.rawBody = body;
    next();
  });

  req.on('error', () => {
    res.status(400).json({ error: 'Failed to read request body' });
  });
});

// POST /import
app.post('/import', (req, res) => {
  const xmlData = req.rawBody;

  if (!xmlData || xmlData.trim().length === 0) {
    return res.status(400).json({ error: 'Empty XML document' });
  }

  let items;
  try {
    items = parseXML(xmlData);
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(400).json({ error: 'Invalid XML format' });
  }

  if (items.length === 0) {
    return res.status(200).json({ message: '0 items imported', items: [] });
  }

  // Limit number of items per import to prevent DoS (CWE-400)
  const MAX_ITEMS = 1000;
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ error: 'Too many items in a single import' });
  }

  // Store items in database
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  let errorOccurred = false;
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
    });

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
          // CWE-209: Don't expose internal error details
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
      // CWE-209: Don't expose internal error details
      return res.status(500).json({ error: 'Failed to retrieve items' });
    }
    return res.status(200).json(rows);
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception occurred');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection occurred');
  process.exit(1);
});