const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';

// Middleware to parse raw text/XML
app.use(express.text({ type: 'application/xml' }));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH);

// Create table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    )`);
});

// Simple XML parser function
function parseXML(xmlString) {
    const items = [];
    
    try {
        // Remove XML declaration and normalize whitespace
        const cleanXml = xmlString.replace(/<\?xml[^>]*\?>/g, '').trim();
        
        // Find all <item>...</item> blocks (allowing attributes on item tag)
        const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
        let match;
        
        while ((match = itemRegex.exec(cleanXml)) !== null) {
            const itemContent = match[1];
            
            // Extract name and value (allowing attributes on name/value tags)
            const nameMatch = /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(itemContent);
            const valueMatch = /<value\b[^>]*>([\s\S]*?)<\/value>/i.exec(itemContent);
            
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
        return [];
    }
}

// POST /import endpoint
app.post('/import', (req, res) => {
    try {
        const xmlData = req.body;
        
        if (!xmlData || typeof xmlData !== 'string') {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        const items = parseXML(xmlData);
        
        if (items.length === 0) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        // Insert items into database
        db.serialize(() => {
            const stmt = db.prepare("INSERT INTO items (name, value) VALUES (?, ?)");
            
            items.forEach(item => {
                stmt.run([item.name, item.value]);
            });
            
            stmt.finalize(() => {
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
    db.all("SELECT name, value FROM items", (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(rows);
        }
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});