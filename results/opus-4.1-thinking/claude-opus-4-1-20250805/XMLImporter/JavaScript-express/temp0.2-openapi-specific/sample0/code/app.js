const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// Parse raw body for XML with size limit (CWE-400)
app.use(express.raw({ 
    type: 'application/xml',
    limit: '1mb'
}));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create items table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Database initialization failed');
            process.exit(1);
        }
    });
});

// Safe XML parser for specific format (prevents CWE-611)
function parseXML(xmlBuffer) {
    try {
        // Convert buffer to string
        const xmlText = xmlBuffer.toString('utf-8');
        
        // Size check
        if (xmlText.length > 1048576) {
            return null;
        }
        
        // Remove XML declaration
        let cleaned = xmlText.replace(/<\?xml[^?>]*\?>/gi, '').trim();
        
        // Validate structure
        if (!cleaned.match(/^\s*<items>[\s\S]*<\/items>\s*$/)) {
            return null;
        }
        
        // Extract items safely
        const items = [];
        const itemMatches = cleaned.match(/<item>[\s\S]*?<\/item>/g);
        
        if (!itemMatches) {
            return [];
        }
        
        // Limit number of items (CWE-400)
        const maxItems = 1000;
        const itemsToProcess = itemMatches.slice(0, maxItems);
        
        for (const itemMatch of itemsToProcess) {
            const nameMatch = /<name>(.*?)<\/name>/s.exec(itemMatch);
            const valueMatch = /<value>(.*?)<\/value>/s.exec(itemMatch);
            
            if (nameMatch && valueMatch) {
                const name = decodeXMLEntities(nameMatch[1].trim());
                const value = decodeXMLEntities(valueMatch[1].trim());
                
                if (name.length > 0 && name.length <= 255 && 
                    value.length > 0 && value.length <= 255) {
                    items.push({ name, value });
                }
            }
        }
        
        return items;
    } catch (error) {
        return null;
    }
}

// Decode basic XML entities
function decodeXMLEntities(str) {
    return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

// Promisify database operations
function runQuery(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id: this.lastID, changes: this.changes });
            }
        });
    });
}

function getAllQuery(query, params) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
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
        // Validate request body
        if (!req.body || req.body.length === 0) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        // Parse XML safely
        const items = parseXML(req.body);
        
        if (items === null) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        if (items.length === 0) {
            return res.status(400).json({ error: 'Invalid XML format' });
        }
        
        // Store items in database
        const storedItems = [];
        
        for (const item of items) {
            try {
                await runQuery(
                    'INSERT INTO items (name, value) VALUES (?, ?)',
                    [item.name, item.value]
                );
                storedItems.push({
                    name: item.name,
                    value: item.value
                });
            } catch (dbErr) {
                // CWE-703: Handle database errors gracefully
                console.error('Database insert failed');
            }
        }
        
        res.status(200).json({
            message: `${storedItems.length} items imported`,
            items: storedItems
        });
        
    } catch (error) {
        // CWE-209: Don't expose sensitive error details
        console.error('Import processing failed');
        res.status(400).json({ error: 'Invalid XML format' });
    }
});

// GET /items endpoint
app.get('/items', async (req, res) => {
    try {
        const rows = await getAllQuery(
            'SELECT name, value FROM items ORDER BY id DESC LIMIT 10000',
            []
        );
        res.status(200).json(rows || []);
    } catch (error) {
        // CWE-209 & CWE-703: Generic error message
        console.error('Database query failed');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
    // CWE-209: Don't expose stack traces
    console.error('Unexpected error occurred');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('Shutting down...');
    server.close(() => {
        db.close((err) => {
            if (err) {
                console.error('Database close failed');
            }
            process.exit(0);
        });
    });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception');
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection');
    gracefulShutdown();
});