const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err);
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
            console.error('Error creating carts table:', err);
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
            console.error('Error creating cart_items table:', err);
            process.exit(1);
        }
    });
});

// Input validation helper
function validateInput(data, schema) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Invalid request body' };
    }
    
    for (const [key, rules] of Object.entries(schema)) {
        if (rules.required && !(key in data)) {
            return { valid: false, error: `Missing required field: ${key}` };
        }
        
        if (key in data && data[key] !== null && data[key] !== undefined) {
            const value = data[key];
            
            if (rules.type === 'string') {
                if (typeof value !== 'string') {
                    return { valid: false, error: `Field ${key} must be a string` };
                }
                if (value.length === 0) {
                    return { valid: false, error: `Field ${key} cannot be empty` };
                }
                if (rules.maxLength && value.length > rules.maxLength) {
                    return { valid: false, error: `Field ${key} is too long` };
                }
            }
            
            if (rules.type === 'integer') {
                if (!Number.isInteger(value)) {
                    return { valid: false, error: `Field ${key} must be an integer` };
                }
                if (rules.min !== undefined && value < rules.min) {
                    return { valid: false, error: `Field ${key} must be >= ${rules.min}` };
                }
                if (rules.max !== undefined && value > rules.max) {
                    return { valid: false, error: `Field ${key} must be <= ${rules.max}` };
                }
            }
        }
    }
    
    // Check for unexpected fields
    const allowedKeys = Object.keys(schema);
    const providedKeys = Object.keys(data);
    for (const key of providedKeys) {
        if (!allowedKeys.includes(key)) {
            return { valid: false, error: `Unexpected field: ${key}` };
        }
    }
    
    return { valid: true };
}

// POST /create_cart
app.post('/create_cart', (req, res) => {
    try {
        const cartId = uuidv4();
        
        db.run(
            'INSERT INTO carts (cart_id) VALUES (?)',
            [cartId],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Failed to create cart' });
                }
                
                res.status(201).json({ cart_id: cartId });
            }
        );
    } catch (error) {
        console.error('Error creating cart:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
    try {
        // Validate input
        const validation = validateInput(req.body, {
            cart_id: { 
                required: true, 
                type: 'string',
                maxLength: 255
            },
            item_id: { 
                required: true, 
                type: 'integer',
                min: -2147483648,
                max: 2147483647
            },
            count: { 
                required: true, 
                type: 'integer',
                min: -2147483648,
                max: 2147483647
            }
        });
        
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        const { cart_id, item_id, count } = req.body;
        
        // First check if cart exists
        db.get(
            'SELECT cart_id FROM carts WHERE cart_id = ?',
            [cart_id],
            (err, cart) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!cart) {
                    return res.status(404).json({ error: 'Cart not found' });
                }
                
                // Check if item already exists in cart
                db.get(
                    'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
                    [cart_id, item_id],
                    (err, item) => {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        if (item) {
                            // Update existing item
                            const newCount = item.count + count;
                            
                            if (newCount <= 0) {
                                // Remove item from cart
                                db.run(
                                    'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                                    [cart_id, item_id],
                                    (err) => {
                                        if (err) {
                                            console.error('Database error:', err);
                                            return res.status(500).json({ error: 'Failed to remove item' });
                                        }
                                        res.status(200).send();
                                    }
                                );
                            } else {
                                // Update count
                                db.run(
                                    'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                                    [newCount, cart_id, item_id],
                                    (err) => {
                                        if (err) {
                                            console.error('Database error:', err);
                                            return res.status(500).json({ error: 'Failed to update item' });
                                        }
                                        res.status(200).send();
                                    }
                                );
                            }
                        } else {
                            // Add new item to cart
                            if (count <= 0) {
                                return res.status(400).json({ error: 'Cannot add item with non-positive count' });
                            }
                            
                            db.run(
                                'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                                [cart_id, item_id, count],
                                (err) => {
                                    if (err) {
                                        console.error('Database error:', err);
                                        return res.status(500).json({ error: 'Failed to add item' });
                                    }
                                    res.status(200).send();
                                }
                            );
                        }
                    }
                );
            }
        );
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
    try {
        // Validate input
        const validation = validateInput(req.body, {
            cart_id: { 
                required: true, 
                type: 'string',
                maxLength: 255
            }
        });
        
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        const { cart_id } = req.body;
        
        // First check if cart exists
        db.get(
            'SELECT cart_id FROM carts WHERE cart_id = ?',
            [cart_id],
            (err, cart) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!cart) {
                    return res.status(404).json({ error: 'Cart not found' });
                }
                
                // Retrieve all items in cart
                db.all(
                    'SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
                    [cart_id],
                    (err, items) => {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        res.status(200).json({ 
                            items: items || []
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Error retrieving cart:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    db.close((err) => {
        if (err) {
            console.error('Database connection close error:', err);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    db.close((err) => {
        if (err) {
            console.error('Database connection close error:', err);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});