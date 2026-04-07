const express = require('express');
const Database = require('better-sqlite3');
const { DOMParser } = require('xmldom');

const app = express();
app.use(express.raw({ type: ['application/xml', 'text/xml'], limit: '500kb' }));
app.use(express.json());

const db = new Database('xmlimporter.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL DEFAULT 0
  )
`);

// Rate limiting
const rateLimitStore = {};
function rateLimit(maxRequests = 20, windowSec = 60) {
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = windowSec * 1000;
    if (!rateLimitStore[ip]) rateLimitStore[ip] = [];
    rateLimitStore[ip] = rateLimitStore[ip].filter(t => now - t < windowMs);
    if (rateLimitStore[ip].length >= maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    rateLimitStore[ip].push(now);
    next();
  };
}

// Security headers
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Content-Security-Policy', "default-src 'none'");
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
});

function getElementText(parent, tagName) {
  const elements = parent.getElementsByTagName(tagName);
  if (elements.length > 0 && elements[0].firstChild) {
    return elements[0].firstChild.nodeValue || '';
  }
  return '';
}

function sanitizeString(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

function stripDTDAndEntities(xml) {
  // Remove DOCTYPE declarations, ENTITY declarations, and SYSTEM/PUBLIC refs
  let cleaned = xml.replace(/<!DOCTYPE[^>]*(?:\[[^\]]*\])?\s*>/gi, '');
  cleaned = cleaned.replace(/<!ENTITY[^>]*>/gi, '');
  return cleaned;
}

app.post('/import', rateLimit(20, 60), (req, res) => {
  let xmlData = req.body;
  if (Buffer.isBuffer(xmlData)) {
    xmlData = xmlData.toString('utf8');
  }
  if (!xmlData || typeof xmlData !== 'string') {
    return res.status(400).json({ error: 'No XML data provided' });
  }

  // Strip DTD and entity declarations to prevent XXE
  xmlData = stripDTDAndEntities(xmlData);

  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlData, 'text/xml');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid or malicious XML' });
  }

  const itemElements = doc.getElementsByTagName('item');
  const items = [];
  const maxItems = 1000;
  const insert = db.prepare('INSERT INTO items (name, description, price) VALUES (?, ?, ?)');

  const insertMany = db.transaction(() => {
    const count = Math.min(itemElements.length, maxItems);
    for (let i = 0; i < count; i++) {
      const elem = itemElements[i];
      const name = sanitizeString(getElementText(elem, 'name'), 500);
      const description = sanitizeString(getElementText(elem, 'description'), 2000);
      const priceText = getElementText(elem, 'price').trim();
      let price = parseFloat(priceText) || 0;
      if (price < 0 || price > 1_000_000 || !isFinite(price)) price = 0;

      if (name) {
        const result = insert.run(name, description, price);
        items.push({ id: result.lastInsertRowid, name, description, price });
      }
    }
  });

  insertMany();
  res.json({ items });
});

app.get('/items', (req, res) => {
  const items = db.prepare('SELECT id, name, description, price FROM items').all();
  res.json(items);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
