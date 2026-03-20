const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

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
function validateInput(data, requiredFields, types) {
    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            return { valid: false, error: `Missing required field: ${field}` };
        }
        
        const expectedType = types[field];
        if (expectedType === 'string' && typeof data[field] !== 'string') {
            return { valid: false, error: `Field ${field} must be a string` };
        }
        if (expectedType === 'integer' && (!Number.isInteger(data[field]) || typeof data[field] !== 'number')) {
            return { valid: false, error: `Field ${field} must be an integer` };
        }
    }
    return { valid: true };
}

// Error handler middleware
function errorHandler(err, req, res, next) {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
}

// Create cart endpoint
app.post('/create_cart', async (req, res, next) => {
    try {
        const cartId = uuidv4();
        
        db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Failed to create cart' });
            }
            
            res.status(201).json({ cart_id: cartId });
        });
    } catch (err) {
        next(err);
    }
});

// Add to cart endpoint
app.post('/add_to_cart', async (req, res, next) => {
    try {
        const validation = validateInput(req.body, ['cart_id', 'item_id', 'count'], {
            cart_id: 'string',
            item_id: 'integer',
            count: 'integer'
        });
        
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        const { cart_id, item_id, count } = req.body;
        
        // Validate cart_id format (UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(cart_id)) {
            return res.status(400).json({ error: 'Invalid cart_id format' });
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
            db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                [cart_id, item_id], (err, item) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (item) {
                    // Update existing item
                    const newCount = item.count + count;
                    
                    if (newCount <= 0) {
                        // Remove item if count becomes 0 or negative
                        db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                            [cart_id, item_id], (err) => {
                            if (err) {
                                console.error('Database error:', err.message);
                                return res.status(500).json({ error: 'Failed to update cart' });
                            }
                            res.status(200).json({ message: 'Item removed from cart' });
                        });
                    } else {
                        // Update count
                        db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                            [newCount, cart_id, item_id], (err) => {
                            if (err) {
                                console.error('Database error:', err.message);
                                return res.status(500).json({ error: 'Failed to update cart' });
                            }
                            res.status(200).json({ message: 'Cart updated successfully' });
                        });
                    }
                } else {
                    // Add new item
                    if (count <= 0) {
                        return res.status(400).json({ error: 'Cannot add item with non-positive count' });
                    }
                    
                    db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                        [cart_id, item_id, count], (err) => {
                        if (err) {
                            console.error('Database error:', err.message);
                            return res.status(500).json({ error: 'Failed to add item to cart' });
                        }
                        res.status(200).json({ message: 'Item added to cart' });
                    });
                }
            });
        });
    } catch (err) {
        next(err);
    }
});

// Retrieve cart endpoint
app.post('/retrieve_cart', async (req, res, next) => {
    try {
        const validation = validateInput(req.body, ['cart_id'], {
            cart_id: 'string'
        });
        
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        const { cart_id } = req.body;
        
        // Validate cart_id format (UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(cart_id)) {
            return res.status(400).json({ error: 'Invalid cart_id format' });
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
            
            // Get all items in cart
            db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, items) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ error: 'Failed to retrieve cart items' });
                }
                
                res.status(200).json({ items: items || [] });
            });
        });
    } catch (err) {
        next(err);
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
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