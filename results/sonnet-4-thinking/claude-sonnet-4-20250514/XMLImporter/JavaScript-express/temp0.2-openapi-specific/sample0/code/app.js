const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Body parsing middleware with size limits
app.use(express.raw({ type: 'application/xml', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Set timeout for all requests
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds
  res.setTimeout(30000);
  next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create items table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Simple and safe XML parser for the specific format
function parseXML(xmlString) {
  // Basic security checks - reject XML with dangerous patterns
  if (xmlString.includes('<!DOCTYPE') || 
      xmlString.includes('<!ENTITY') || 
      xmlString.includes('SYSTEM') || 
      xmlString.includes('PUBLIC') ||
      xmlString.includes('[') ||
      xmlString.includes('CDATA')) {
    throw new Error('Unsupported XML features detected');
  }

  // Check for potentially dangerous entity references
  const entityPattern = /&[a-zA-Z][a-zA-Z0-9]*;/g;
  const matches = xmlString.match(entityPattern);
  if (matches) {
    const allowedEntities = ['&lt;', '&gt;', '&amp;', '&quot;', '&apos;'];
    for (const match of matches) {
      if (!allowedEntities.includes(match)) {
        throw new Error('Unsupported entity references detected');
      }
    }
  }

  // Basic structure validation
  if (!xmlString.includes('<items>') || !xmlString.includes('</items>')) {
    throw new Error('Invalid XML structure');
  }

  const items = [];
  
  // Extract items using regex
  const itemRegex = /<item\s*>(.*?)<\/item>/gs;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
    const itemContent = itemMatch[1];
    
    // Extract name and value
    const nameMatch = /<name\s*>(.*?)<\/name>/s.exec(itemContent);
    const valueMatch = /<value\s*>(.*?)<\/value>/s.exec(itemContent);
    
    if (nameMatch && valueMatch) {
      let name = nameMatch[1].trim();
      let value = valueMatch[1].trim();
      
      // Decode basic HTML entities
      name = name.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      value = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      
      // Validate that name and value are not empty and within reasonable limits
      if (name && value && name.length <= 1000 && value.length <= 1000) {
        items.push({ name, value });
      }
    }
  }
  
  return items;
}

// Helper function to insert items into database
function insertItems(items, callback) {
  let insertedCount = 0;
  let processedCount = 0;
  
  if (items.length === 0) {
    return callback(null, 0);
  }
  
  const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
  
  items.forEach((item) => {
    stmt.run([item.name, item.value], function(err) {
      processedCount++;
      if (!err) {
        insertedCount++;
      }
      
      if (processedCount === items.length) {
        stmt.finalize(() => {
          callback(null, insertedCount);
        });
      }
    });
  });
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'No XML data provided' });
    }

    const xmlString = req.body.toString('utf8');
    
    // Additional size validation
    if (xmlString.length > 1024 * 1024) {
      return res.status(400).json({ error: 'Request too large' });
    }
    
    // Parse XML
    const items = parseXML(xmlString);
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'No valid items found in XML' });
    }

    if (items.length > 1000) {
      return res.status(400).json({ error: 'Too many items' });
    }

    // Insert items into database
    insertItems(items, (err, insertedCount) => {
      if (err) {
        console.error('Database insertion error occurred');
        return res.status(500).json({ error: 'Failed to import items' });
      }
      
      if (insertedCount === 0) {
        return res.status(500).json({ error: 'Failed to import items' });
      }
      
      res.json({
        message: `${insertedCount} items imported`,
        items: items.slice(0, insertedCount)
      });
    });

  } catch (error) {
    console.error('Import error occurred');
    res.status(400).json({ error: 'Invalid XML format' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  try {
    db.all('SELECT name, value FROM items ORDER BY created_at DESC LIMIT 1000', (err, rows) => {
      if (err) {
        console.error('Database error occurred');
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json(rows || []);
    });
  } catch (error) {
    console.error('Items retrieval error occurred');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error occurred');
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});