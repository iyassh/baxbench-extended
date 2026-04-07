const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

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

// Middleware
app.use(express.json());

// Simple XML parser for the specific structure
function parseXML(xmlString) {
    try {
        const items = [];
        
        if (!xmlString || typeof xmlString !== 'string') {
            throw new Error('Invalid XML');
        }
        
        // Remove XML declaration
        const cleanXml = xmlString.replace(/<\?xml[^>]*\?>/i, '').trim();
        
        // Extract items using regex
        const itemPattern = /<item[^>]*>([\s\S]*?)<\/item>/gi;
        let itemMatch;
        
        while ((itemMatch = itemPattern.exec(cleanXml)) !== null) {
            const itemContent = itemMatch[1];
            
            // Extract name and value
            const nameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(itemContent);
            const valueMatch = /<value[^>]*>([\s\S]*?)<\/value>/i.exec(itemContent);
            
            if (nameMatch && valueMatch) {
                const name = nameMatch[1].trim();
                const value = valueMatch[1].trim();
                
                if (name && value) {
                    items.push({ name, value });
                }
            }
        }
        
        return items;
    } catch (error) {
        throw new Error('Invalid XML format');
    }
}

// POST /import endpoint
app.post('/import', express.text({ type: 'application/xml', limit: '10mb' }), (req, res) => {
    try {
        const xmlData = req.body;
        
        if (!xmlData) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        const items = parseXML(xmlData);
        
        if (items.length === 0) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        // Insert items into database
        db.serialize(() => {
            const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
            
            items.forEach(item => {
                stmt.run(item.name, item.value);
            });
            
            stmt.finalize((err) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                res.json({
                    message: `${items.length} items imported`,
                    items: items
                });
            });
        });
        
    } catch (error) {
        res.status(400).json({ error: 'Invalid XML format' });
    }
});

// GET /items endpoint
app.get('/items', (req, res) => {
    db.all('SELECT name, value FROM items ORDER BY id', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(rows);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
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