const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Body parser for XML with size limit (prevent resource exhaustion)
app.use(express.raw({ 
  type: 'application/xml', 
  limit: '1mb' 
}));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database');
    process.exit(1);
  }
});

// Create items table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Failed to create table');
    process.exit(1);
  }
});

// Safe XML parser - prevents XXE attacks by not supporting external entities
function parseItemsXML(xmlData) {
  const xml = xmlData.toString().trim();
  
  // Security checks - prevent XXE attacks
  if (xml.includes('<!DOCTYPE') || 
      xml.includes('<!ENTITY') || 
      xml.includes('SYSTEM') || 
      xml.includes('PUBLIC')) {
    throw new Error('Potentially malicious XML detected');
  }
  
  // Check for maximum reasonable length to prevent DoS
  if (xml.length > 100000) {
    throw new Error('XML too large');
  }
  
  const items = [];
  
  // Validate basic structure
  if (!xml.match(/<items>/i) || !xml.match(/<\/items>/i)) {
    throw new Error('Invalid XML structure');
  }
  
  // Extract items using regex (safe for our limited use case)
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi);
  
  if (!itemMatches) {
    return items;
  }
  
  // Limit number of items to prevent resource exhaustion
  if (itemMatches.length > 1000) {
    throw new Error('Too many items');
  }
  
  for (const itemXml of itemMatches) {
    const nameMatch = itemXml.match(/<name>([^<]*)<\/name>/i);
    const valueMatch = itemXml.match(/<value>([^<]*)<\/value>/i);
    
    if (nameMatch && nameMatch[1] !== undefined && 
        valueMatch && valueMatch[1] !== undefined) {
      const name = nameMatch[1].trim();
      const value = valueMatch[1].trim();
      
      // Validate item data
      if (name.length > 0 && name.length <= 255 && 
          value.length > 0 && value.length <= 255) {
        items.push({ name, value });
      }
    }
  }
  
  return items;
}

// POST /import endpoint
app.post('/import', (req, res) => {
  try {
    // Validate request body
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Parse XML
    let items;
    try {
      items = parseItemsXML(req.body);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    if (items.length === 0) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }
    
    // Insert items into database
    const insertedItems = [];
    let completed = 0;
    let hasError = false;
    
    const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
    
    items.forEach((item, index) => {
      stmt.run(item.name, item.value, function(err) {
        completed++;
        
        if (err) {
          hasError = true;
        } else {
          insertedItems.push(item);
        }
        
        // Check if all items have been processed
        if (completed === items.length) {
          stmt.finalize();
          
          if (hasError) {
            res.status(500).json({ error: 'Internal server error' });
          } else {
            res.json({
              message: `${insertedItems.length} items imported`,
              items: insertedItems
            });
          }
        }
      });
    });
    
  } catch (error) {
    // Log error safely without exposing details
    console.error('Import error occurred');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /items endpoint
app.get('/items', (req, res) => {
  db.all('SELECT name, value FROM items ORDER BY id', (err, rows) => {
    if (err) {
      console.error('Database query error');
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.json(rows || []);
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error safely
  console.error('Unhandled error occurred');
  
  // Don't expose error details to client
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('XML Importer API listening on 0.0.0.0:5000');
});

// Graceful shutdown handlers
const shutdown = () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      process.exit(0);
    });
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception occurred');
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection occurred');
  shutdown();
});