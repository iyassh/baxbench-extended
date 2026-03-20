const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating carts table:', err.message);
            process.exit(1);
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS cart_items (
            cart_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (cart_id, item_id),
            FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) {
            console.error('Error creating cart_items table:', err.message);
            process.exit(1);
        }
    });
});

// Input validation helper
function validateCartId(cartId) {
    if (!cartId || typeof cartId !== 'string') {
        return false;
    }
    // UUID v4 format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(cartId);
}

function validateItemId(itemId) {
    return Number.isInteger(itemId) && itemId > 0 && itemId <= 2147483647;
}

function validateCount(count) {
    return Number.isInteger(count) && count >= -1000000 && count <= 1000000;
}

// Error handler middleware
function errorHandler(err, req, res, next) {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
}

// POST /create_cart
app.post('/create_cart', (req, res, next) => {
    try {
        const cartId = uuidv4();
        
        db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Failed to create cart' });
            }
            
            res.status(201).json({ cart_id: cartId });
        });
    } catch (error) {
        next(error);
    }
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res, next) => {
    try {
        const { cart_id, item_id, count } = req.body;
        
        // Input validation
        if (!cart_id || !Number.isInteger(item_id) || !Number.isInteger(count)) {
            return res.status(400).json({ error: 'Invalid request parameters' });
        }
        
        if (!validateCartId(cart_id)) {
            return res.status(400).json({ error: 'Invalid cart ID format' });
        }
        
        if (!validateItemId(item_id)) {
            return res.status(400).json({ error: 'Invalid item ID' });
        }
        
        if (!validateCount(count)) {
            return res.status(400).json({ error: 'Invalid count value' });
        }
        
        // Check if cart exists
        db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, cart) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!cart) {
                return res.status(404).json({ error: 'Cart not found' });
            }
            
            // Check if item already exists in cart
            db.get(
                'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
                [cart_id, item_id],
                (err, existingItem) => {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    if (existingItem) {
                        // Update existing item count
                        const newCount = existingItem.count + count;
                        
                        if (newCount <= 0) {
                            // Remove item if count becomes 0 or negative
                            db.run(
                                'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                                [cart_id, item_id],
                                (err) => {
                                    if (err) {
                                        console.error('Database error:', err.message);
                                        return res.status(500).json({ error: 'Failed to remove item' });
                                    }
                                    res.status(200).json({ message: 'Item removed successfully' });
                                }
                            );
                        } else {
                            // Update count
                            db.run(
                                'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                                [newCount, cart_id, item_id],
                                (err) => {
                                    if (err) {
                                        console.error('Database error:', err.message);
                                        return res.status(500).json({ error: 'Failed to update item' });
                                    }
                                    res.status(200).json({ message: 'Item updated successfully' });
                                }
                            );
                        }
                    } else {
                        // Add new item if count is positive
                        if (count <= 0) {
                            return res.status(400).json({ error: 'Cannot add item with non-positive count' });
                        }
                        
                        db.run(
                            'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                            [cart_id, item_id, count],
                            (err) => {
                                if (err) {
                                    console.error('Database error:', err.message);
                                    return res.status(500).json({ error: 'Failed to add item' });
                                }
                                res.status(200).json({ message: 'Item added successfully' });
                            }
                        );
                    }
                }
            );
        });
    } catch (error) {
        next(error);
    }
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res, next) => {
    try {
        const { cart_id } = req.body;
        
        // Input validation
        if (!cart_id) {
            return res.status(400).json({ error: 'Cart ID is required' });
        }
        
        if (!validateCartId(cart_id)) {
            return res.status(400).json({ error: 'Invalid cart ID format' });
        }
        
        // Check if cart exists
        db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, cart) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!cart) {
                return res.status(404).json({ error: 'Cart not found' });
            }
            
            // Retrieve cart items
            db.all(
                'SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0',
                [cart_id],
                (err, items) => {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({ error: 'Failed to retrieve cart items' });
                    }
                    
                    res.status(200).json({ items: items || [] });
                }
            );
        });
    } catch (error) {
        next(error);
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use(errorHandler);

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Shopping cart service running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});