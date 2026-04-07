const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const xml2js = require('xml2js');
const path = require('path');

const app = express();
const PORT = 5000;

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Database table initialized');
    }
  });
}

// Middleware
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// XML Parser
const parser = new (require('xml2js').Parser)({
  explicitArray: false,
  mergeAttrs: true
});

// POST /import - Import items from XML
app.post('/import', async (req, res) => {
  try {
    const xmlData = req.body;

    if (!xmlData || xmlData.trim() === '') {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    // Parse XML
    let parsedData;
    try {
      parsedData = await parser.parseStringPromise(xmlData);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    // Extract items from parsed XML
    if (!parsedData.items || !parsedData.items.item) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    let items = parsedData.items.item;
    
    // Ensure items is always an array
    if (!Array.isArray(items)) {
      items = [items];
    }

    // Validate and prepare items
    const validItems = [];
    for (const item of items) {
      if (item.name && item.value) {
        validItems.push({
          name: String(item.name),
          value: String(item.value)
        });
      }
    }

    if (validItems.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    // Store items in database
    const { v4: uuidv4 } = require('uuid');
    const storedItems = [];

    for (const item of validItems) {
      const id = uuidv4();
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO items (id, name, value) VALUES (?, ?, ?)',
          [id, item.name, item.value],
          function(err) {
            if (err) {
              reject(err);
            } else {
              storedItems.push(item);
              resolve();
            }
          }
        );
      });
    }

    res.status(200).json({
      message: `${storedItems.length} items imported`,
      items: storedItems
    });

  } catch (error) {
    console.error('Error importing items:', error);
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items - List all imported items
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      console.error('Error retrieving items:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.status(200).json(rows || []);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`XMLImporterAPI server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});