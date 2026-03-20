const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT,
        item_id INTEGER,
        count INTEGER,
        PRIMARY KEY (cart_id, item_id),
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
    )`);
});

// Input validation functions
function validateCartId(cartId) {
    return typeof cartId === 'string' && cartId.length > 0 && cartId.length <= 100;
}

function validateItemId(itemId) {
    return Number.isInteger(itemId) && itemId > 0;
}

function validateCount(count) {
    return Number.isInteger(count) && count !== 0 && count >= -1000000 && count <= 1000000;
}

// Error handling middleware
function handleError(res, error, message = 'Internal server error') {
    console.error('Error:', error);
    res.status(500).json({ error: message });
}

// Create a new shopping cart
app.post('/create_cart', (req, res) => {
    try {
        const cartId = uuidv4();
        
        const stmt = db.prepare('INSERT INTO carts (cart_id) VALUES (?)');
        stmt.run([cartId], function(err) {
            if (err) {
                handleError(res, err);
                return;
            }
            
            res.status(201).json({ cart_id: cartId });
        });
        stmt.finalize();
    } catch (error) {
        handleError(res, error);
    }
});

// Add or remove items from cart
app.post('/add_to_cart', (req, res) => {
    try {
        const { cart_id, item_id, count } = req.body;
        
        // Input validation
        if (!validateCartId(cart_id)) {
            return res.status(400).json({ error: 'Invalid cart_id' });
        }
        
        if (!validateItemId(item_id)) {
            return res.status(400).json({ error: 'Invalid item_id' });
        }
        
        if (!validateCount(count)) {
            return res.status(400).json({ error: 'Invalid count' });
        }
        
        // Check if cart exists
        db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
            if (err) {
                handleError(res, err);
                return;
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Cart not found' });
            }
            
            // Check if item already exists in cart
            db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                [cart_id, item_id], (err, existingItem) => {
                if (err) {
                    handleError(res, err);
                    return;
                }
                
                if (existingItem) {
                    // Update existing item
                    const newCount = existingItem.count + count;
                    
                    if (newCount <= 0) {
                        // Remove item if count becomes 0 or negative
                        const deleteStmt = db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?');
                        deleteStmt.run([cart_id, item_id], function(err) {
                            if (err) {
                                handleError(res, err);
                                return;
                            }
                            res.status(200).json({ message: 'Item removed successfully' });
                        });
                        deleteStmt.finalize();
                    } else {
                        // Update count
                        const updateStmt = db.prepare('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?');
                        updateStmt.run([newCount, cart_id, item_id], function(err) {
                            if (err) {
                                handleError(res, err);
                                return;
                            }
                            res.status(200).json({ message: 'Item updated successfully' });
                        });
                        updateStmt.finalize();
                    }
                } else {
                    // Add new item (only if count is positive)
                    if (count > 0) {
                        const insertStmt = db.prepare('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)');
                        insertStmt.run([cart_id, item_id, count], function(err) {
                            if (err) {
                                handleError(res, err);
                                return;
                            }
                            res.status(200).json({ message: 'Item added successfully' });
                        });
                        insertStmt.finalize();
                    } else {
                        res.status(400).json({ error: 'Cannot add negative count for new item' });
                    }
                }
            });
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Retrieve all items in cart
app.post('/retrieve_cart', (req, res) => {
    try {
        const { cart_id } = req.body;
        
        // Input validation
        if (!validateCartId(cart_id)) {
            return res.status(400).json({ error: 'Invalid cart_id' });
        }
        
        // Check if cart exists
        db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
            if (err) {
                handleError(res, err);
                return;
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Cart not found' });
            }
            
            // Get all items in cart
            db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id', 
                [cart_id], (err, rows) => {
                if (err) {
                    handleError(res, err);
                    return;
                }
                
                const items = rows.map(row => ({
                    item_id: row.item_id,
                    count: row.count
                }));
                
                res.status(200).json({ items });
            });
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shopping cart service running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});