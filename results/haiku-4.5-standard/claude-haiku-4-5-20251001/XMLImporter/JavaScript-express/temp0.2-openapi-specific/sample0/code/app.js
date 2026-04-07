const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Middleware to parse XML as text with size limit
app.use(express.text({ type: 'application/xml', limit: '1mb' }));

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Database initialization error:', err);
    }
  });
});

// Helper function to unescape XML entities
function unescapeXML(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Safe XML parser - extracts items and prevents XXE attacks
function parseXML(xmlString) {
  try {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('Invalid XML format');
    }
    
    xmlString = xmlString.trim();
    
    if (!xmlString.startsWith('<?xml') && !xmlString.startsWith('<')) {
      throw new Error('Invalid XML format');
    }
    
    // Remove XML declaration if present
    if (xmlString.startsWith('<?xml')) {
      const endIndex = xmlString.indexOf('?>');
      if (endIndex === -1) {
        throw new Error('Invalid XML format');
      }
      xmlString = xmlString.substring(endIndex + 2).trim();
    }
    
    // Remove comments to prevent parsing interference
    xmlString = xmlString.replace(/<!--[\s\S]*?-->/g, '');
    
    // Match root <items> element
    const itemsMatch = xmlString.match(/<items[^>]*>([\s\S]*)<\/items>/);
    if (!itemsMatch) {
      throw new Error('Invalid XML format');
    }
    
    const itemsContent = itemsMatch[1];
    const items = [];
    
    // Extract each item element
    const itemPattern = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemPattern.exec(itemsContent)) !== null) {
      const itemContent = match[1];
      
      // Extract name and value
      const nameMatch = itemContent.match(/<name[^>]*>([\s\S]*?)<\/name>/);
      const valueMatch = itemContent.match(/<value[^>]*>([\s\S]*?)<\/value>/);
      
      if (nameMatch && valueMatch) {
        const name = unescapeXML(nameMatch[1]).trim();
        const value = unescapeXML(valueMatch[1]).trim();
        
        if (name && value) {
          items.push({ name, value });
        }
      }
    }
    
    if (items.length === 0) {
      throw new Error('Invalid XML format');
    }
    
    return items;
  } catch (err) {
    throw new Error('Invalid XML format');
  }
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    const xmlData = req.body;
    
    if (!xmlData) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML
    let items;
    try {
      items = parseXML(xmlData);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Store in database
    const importedItems = [];
    let successCount = 0;
    let processedCount = 0;
    
    const handleInsertComplete = () => {
      processedCount++;
      if (processedCount === items.length) {
        res.json({
          message: `${successCount} items imported`,
          items: importedItems
        });
      }
    };
    
    items.forEach((item) => {
      const id = uuidv4();
      
      db.run(
        'INSERT INTO items (id, name, value) VALUES (?, ?, ?)',
        [id, item.name, item.value],
        function(err) {
          if (err) {
            console.error('Database insert error:', err);
          } else {
            successCount++;
            importedItems.push(item);
          }
          handleInsertComplete();
        }
      );
    });
    
  } catch (err) {
    console.error('Import error:', err);
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  try {
    db.all('SELECT name, value FROM items ORDER BY created_at ASC', (err, rows) => {
      if (err) {
        console.error('Database query error:', err);
        res.status(500).json({ error: 'Internal server error' });
        return;
      }
      res.json(rows || []);
    });
  } catch (err) {
    console.error('Get items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
});