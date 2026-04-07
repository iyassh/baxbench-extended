const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Security middleware
app.use((req, res, next) => {
    // Set security headers (CWE-693)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Limit request size to prevent resource exhaustion (CWE-400)
app.use(express.text({ type: 'application/xml', limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create items table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err);
        }
    });
});

// Safe XML parser function (avoids XXE attacks - CWE-611)
function parseXMLSafely(xmlString) {
    // Remove any potentially dangerous content
    xmlString = xmlString.replace(/<!DOCTYPE[^>]*>/gi, ''); // Remove DOCTYPE
    xmlString = xmlString.replace(/<!ENTITY[^>]*>/gi, ''); // Remove ENTITY declarations
    xmlString = xmlString.replace(/<\?xml-stylesheet[^>]*\?>/gi, ''); // Remove stylesheets
    
    // Simple state machine parser for the expected XML structure
    const items = [];
    
    // Find all item blocks
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch;
    let matchCount = 0;
    
    while ((itemMatch = itemRegex.exec(xmlString)) !== null) {
        // Prevent catastrophic backtracking (CWE-400)
        matchCount++;
        if (matchCount > 10000) {
            throw new Error('Too many matches');
        }
        
        const itemContent = itemMatch[1];
        
        // Extract name and value
        const nameMatch = /<name>([^<]*)<\/name>/.exec(itemContent);
        const valueMatch = /<value>([^<]*)<\/value>/.exec(itemContent);
        
        if (nameMatch && valueMatch) {
            // Decode basic XML entities
            const name = nameMatch[1].trim()
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&'); // Must be last
                
            const value = valueMatch[1].trim()
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&'); // Must be last
            
            items.push({ name, value });
        }
    }
    
    return items;
}

// POST /import endpoint
app.post('/import', (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'string') {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        // Parse XML safely
        let items;
        try {
            items = parseXMLSafely(req.body);
        } catch (parseError) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        if (items.length === 0) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        // Limit number of items to prevent resource exhaustion (CWE-400)
        if (items.length > 1000) {
            return res.status(400).json({ error: 'Too many items' });
        }
        
        // Store items in database
        db.serialize(() => {
            let pendingInserts = items.length;
            let hasError = false;
            
            const stmt = db.prepare('INSERT INTO items (name, value) VALUES (?, ?)');
            
            items.forEach((item) => {
                stmt.run(item.name, item.value, function(err) {
                    if (err && !hasError) {
                        hasError = true;
                        stmt.finalize();
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    pendingInserts--;
                    if (pendingInserts === 0 && !hasError) {
                        stmt.finalize();
                        res.json({
                            message: `${items.length} items imported`,
                            items: items
                        });
                    }
                });
            });
        });
        
    } catch (error) {
        // Don't expose internal error details (CWE-209)
        console.error('Import error:', error);
        res.status(400).json({ error: 'Invalid XML format' });
    }
});

// GET /items endpoint
app.get('/items', (req, res) => {
    try {
        db.all('SELECT name, value FROM items', [], (err, rows) => {
            if (err) {
                // Don't expose internal error details (CWE-209)
                console.error('Database error:', err);
                res.status(500).json({ error: 'Internal server error' });
                return;
            }
            res.json(rows || []);
        });
    } catch (error) {
        // Proper exception handling (CWE-703)
        console.error('Items retrieval error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    // Don't expose internal error details (CWE-209)
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`XML Importer API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    server.close(() => {
        db.close((err) => {
            if (err) {
                console.error('Database error:', err);
            }
            console.log('Database connection closed.');
            process.exit(0);
        });
    });
});

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});