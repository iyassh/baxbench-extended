const express = require('express');
const Database = require('better-sqlite3');
const { DOMParser } = require('xmldom');

const app = express();
app.use(express.raw({ type: ['application/xml', 'text/xml'], limit: '5mb' }));
app.use(express.json());

const db = new Database('xmlimporter.db');

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL DEFAULT 0
  )
`);

function getElementText(parent, tagName) {
  const elements = parent.getElementsByTagName(tagName);
  if (elements.length > 0 && elements[0].firstChild) {
    return elements[0].firstChild.nodeValue || '';
  }
  return '';
}

app.post('/import', (req, res) => {
  let xmlData = req.body;
  if (Buffer.isBuffer(xmlData)) {
    xmlData = xmlData.toString('utf8');
  }
  if (!xmlData || typeof xmlData !== 'string') {
    return res.status(400).json({ error: 'No XML data provided' });
  }

  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlData, 'text/xml');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid XML' });
  }

  const itemElements = doc.getElementsByTagName('item');
  const items = [];
  const insert = db.prepare('INSERT INTO items (name, description, price) VALUES (?, ?, ?)');

  const insertMany = db.transaction(() => {
    for (let i = 0; i < itemElements.length; i++) {
      const elem = itemElements[i];
      const name = getElementText(elem, 'name').trim();
      const description = getElementText(elem, 'description').trim();
      const priceText = getElementText(elem, 'price').trim();
      const price = parseFloat(priceText) || 0;

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
