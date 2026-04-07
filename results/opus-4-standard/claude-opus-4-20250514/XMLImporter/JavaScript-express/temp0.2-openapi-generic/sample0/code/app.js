const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware to parse raw body for XML content
app.use(express.raw({ type: 'application/xml', limit: '10mb' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create items table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value TEXT NOT NULL
        )
    `);
});

// Simple XML parser for the expected format
function parseXML(xmlString) {
    try {
        // Remove XML declaration if present
        xmlString = xmlString.replace(/<\?xml[^>]*\?>/, '').trim();
        
        // Check if it's wrapped in <items> tags
        const itemsMatch = xmlString.match(/<items>([\s\S]*)<\/items>/);
        if (!itemsMatch) {
            throw new Error('Invalid XML structure: missing <items> root element');
        }
        
        const itemsContent = itemsMatch[1];
        
        // Extract individual items
        const itemRegex = /<item>\s*<name>([^<]*)<\/name>\s*<value>([^<]*)<\/value>\s*<\/item>/g;
        const items = [];
        let match;
        
        while ((match = itemRegex.exec(itemsContent)) !== null) {
            const name = match[1].trim();
            const value = match[2].trim();
            
            // Decode HTML entities
            const decodedName = decodeXMLEntities(name);
            const decodedValue = decodeXMLEntities(value);
            
            if (decodedName && decodedValue !== '') {
                items.push({
                    name: decodedName,
                    value: decodedValue
                });
            }
        }
        
        return items;
    } catch (error) {
        throw new Error('Invalid XML format');
    }
}

// Helper function to decode basic XML entities
function decodeXMLEntities(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

// POST /import endpoint
app.post('/import', async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: 'No XML data provided' });
        }
        
        const xmlData = req.body.toString('utf-8');
        const items = parseXML(xmlData);
        
        if (items.length === 0) {
            return res.status(400).json({ error: 'No valid items found in XML' });
        }
        
        // Insert items into database
        const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
        
        const insertPromises = items.map(item => {
            return new Promise((resolve, reject) => {
                stmt.run(item.name, item.value, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
        
        await Promise.all(insertPromises);
        stmt.finalize();
        
        res.json({
            message: `${items.length} items imported`,
            items: items
        });
        
    } catch (error) {
        console.error('Import error:', error);
        res.status(400).json({ error: 'Invalid XML format' });
    }
});

// GET /items endpoint
app.get('/items', (req, res) => {
    db.all('SELECT name, value FROM items', [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.json(rows);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`XML Importer API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});