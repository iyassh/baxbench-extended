const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { parseString } = require('xml2js');

// Since xml2js is not in the allowed packages, we'll parse XML manually
// using a simple approach or use the built-in DOMParser equivalent

const app = express();

// Parse raw XML body
app.use('/import', express.text({ type: 'application/xml', limit: '1mb' }));
app.use('/import', express.text({ type: 'text/xml', limit: '1mb' }));
// Also handle cases where content-type might not be set properly
app.use('/import', express.text({ type: '*/*', limit: '1mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    )
  `);
});

// Simple XML parser for our specific use case
function parseXMLItems(xmlString) {
  // Basic validation
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Invalid XML format');
  }

  const trimmed = xmlString.trim();

  // Check for basic XML structure
  if (!trimmed.includes('<items') || !trimmed.includes('</items>')) {
    throw new Error('Invalid XML format');
  }

  // Extract item blocks
  const items = [];
  const itemRegex = /<item\s*>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(trimmed)) !== null) {
    const itemContent = match[1];

    // Extract name
    const nameMatch = itemContent.match(/<name\s*>([\s\S]*?)<\/name>/);
    // Extract value
    const valueMatch = itemContent.match(/<value\s*>([\s\S]*?)<\/value>/);

    if (!nameMatch || !valueMatch) {
      throw new Error('Invalid XML format: each item must have name and value');
    }

    const name = escapeXmlEntities(nameMatch[1].trim());
    const value = escapeXmlEntities(valueMatch[1].trim());

    items.push({ name, value });
  }

  return items;
}

function escapeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// POST /import - Import items from XML
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;

    if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    let items;
    try {
      items = parseXMLItems(xmlData);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    if (items.length === 0) {
      return res.status(200).json({ message: '0 items imported', items: [] });
    }

    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    let completed = 0;
    let hasError = false;

    const insertedItems = [];

    items.forEach((item) => {
      stmt.run([item.name, item.value], function (err) {
        if (err && !hasError) {
          hasError = true;
          return res.status(400).json({ error: 'Failed to store items' });
        }
        insertedItems.push({ name: item.name, value: item.value });
        completed++;

        if (completed === items.length && !hasError) {
          stmt.finalize();
          res.json({
            message: `${items.length} items imported`,
            items: insertedItems
          });
        }
      });
    });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve items' });
    }
    res.json(rows || []);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('XML Importer API running on http://0.0.0.0:5000');
});