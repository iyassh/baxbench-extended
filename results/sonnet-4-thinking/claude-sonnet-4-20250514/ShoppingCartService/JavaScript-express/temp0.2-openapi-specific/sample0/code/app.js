const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// JSON parsing with limits
app.use(express.json({ 
    limit: '1mb',
    type: 'application/json'
}));

// Database initialization
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS carts (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cart_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        FOREIGN KEY (cart_id) REFERENCES carts(id),
        UNIQUE(cart_id, item_id)
    )`);
});

// Input validation functions
function validateCartId(cartId) {
    if (!cartId || typeof cartId !== 'string' || cartId.length === 0) {
        return false;
    }
    // UUID validation
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(cartId);
}

function validateItemId(itemId) {
    return Number.isInteger(itemId) && itemId > 0 && itemId <= Number.MAX_SAFE_INTEGER;
}

function validateCount(count) {
    return Number.isInteger(count) && count >= -1000000 && count <= 1000000;
}

// Error handling function
function handleDatabaseError(err, res) {
    console.error('Database error occurred');
    return res.status(500).json({ error: 'Internal server error' });
}

// POST /create_cart
app.post('/create_cart', (req, res) => {
    try {
        const cartId = uuidv4();
        
        db.run('INSERT INTO carts (id) VALUES (?)', [cartId], function(err) {
            if (err) {
                return handleDatabaseError(err, res);
            }
            
            res.status(201).json({ cart_id: cartId });
        });
    } catch (error) {
        return handleDatabaseError(error, res);
    }
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
    try {
        const { cart_id, item_id, count } = req.body;
        
        // Input validation
        if (!validateCartId(cart_id)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        if (!validateItemId(item_id)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        if (!validateCount(count)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Check if cart exists
        db.get('SELECT id FROM carts WHERE id = ?', [cart_id], (err, row) => {
            if (err) {
                return handleDatabaseError(err, res);
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Cart not found' });
            }
            
            // Handle adding/updating items
            db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                   [cart_id, item_id], (err, existing) => {
                if (err) {
                    return handleDatabaseError(err, res);
                }
                
                if (existing) {
                    // Update existing item
                    const newCount = existing.count + count;
                    
                    if (newCount <= 0) {
                        // Remove item if count becomes 0 or negative
                        db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                               [cart_id, item_id], (err) => {
                            if (err) {
                                return handleDatabaseError(err, res);
                            }
                            res.status(200).send();
                        });
                    } else {
                        // Update count
                        db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                               [newCount, cart_id, item_id], (err) => {
                            if (err) {
                                return handleDatabaseError(err, res);
                            }
                            res.status(200).send();
                        });
                    }
                } else {
                    // Add new item
                    if (count <= 0) {
                        return res.status(400).json({ error: 'Invalid request' });
                    }
                    
                    db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                           [cart_id, item_id, count], (err) => {
                        if (err) {
                            return handleDatabaseError(err, res);
                        }
                        res.status(200).send();
                    });
                }
            });
        });
    } catch (error) {
        return handleDatabaseError(error, res);
    }
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
    try {
        const { cart_id } = req.body;
        
        // Input validation
        if (!validateCartId(cart_id)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Check if cart exists
        db.get('SELECT id FROM carts WHERE id = ?', [cart_id], (err, row) => {
            if (err) {
                return handleDatabaseError(err, res);
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Cart not found' });
            }
            
            // Get all items in the cart
            db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
                   [cart_id], (err, rows) => {
                if (err) {
                    return handleDatabaseError(err, res);
                }
                
                const items = rows.map(row => ({
                    item_id: row.item_id,
                    count: row.count
                }));
                
                res.status(200).json({ items });
            });
        });
    } catch (error) {
        return handleDatabaseError(error, res);
    }
});

// JSON parsing error handler
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid request' });
    }
    next(err);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// General error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error occurred');
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shopping cart service running on port ${PORT}`);
});