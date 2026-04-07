const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    )`);
});

// Middleware
app.use('/import', express.raw({ type: ['application/xml', 'text/xml'], limit: '10mb' }));
app.use(express.json());

// Simple XML parser for the specific format
function parseXML(xmlString) {
    const items = [];
    
    // Clean up the XML string
    const cleanXml = xmlString.trim();
    
    // Remove XML declaration and root tags
    const itemsMatch = cleanXml.match(/<items\s*>(.*?)<\/items>/s);
    if (!itemsMatch) {
        throw new Error('Invalid XML format: missing <items> root element');
    }
    
    const itemsContent = itemsMatch[1];
    
    // Extract each item
    const itemMatches = itemsContent.match(/<item\s*>(.*?)<\/item>/gs);
    if (!itemMatches) {
        return items; // Empty items array if no items found
    }
    
    for (const itemMatch of itemMatches) {
        const nameMatch = itemMatch.match(/<name\s*>(.*?)<\/name>/s);
        const valueMatch = itemMatch.match(/<value\s*>(.*?)<\/value>/s);
        
        if (nameMatch && valueMatch) {
            const name = nameMatch[1].trim();
            const value = valueMatch[1].trim();
            
            // Validate that name and value are not empty
            if (name && value) {
                items.push({ name, value });
            }
        }
    }
    
    return items;
}

// Database helper functions
function insertItem(name, value) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO items (name, value) VALUES (?, ?)', [name, value], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function getAllItems() {
    return new Promise((resolve, reject) => {
        db.all('SELECT name, value FROM items', (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// POST /import endpoint
app.post('/import', async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: 'No data provided' });
        }
        
        const xmlData = req.body.toString('utf8');
        
        if (!xmlData || xmlData.trim() === '') {
            return res.status(400).json({ error: 'Empty XML data' });
        }
        
        const items = parseXML(xmlData);
        
        // Insert items into database
        for (const item of items) {
            await insertItem(item.name, item.value);
        }
        
        res.json({
            message: `${items.length} items imported`,
            items: items
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(400).json({ error: 'Invalid XML format' });
    }
});

// GET /items endpoint
app.get('/items', async (req, res) => {
    try {
        const items = await getAllItems();
        res.json(items);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`XML Importer API server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});