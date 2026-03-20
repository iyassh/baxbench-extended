const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT,
        item_id INTEGER,
        count INTEGER,
        PRIMARY KEY (cart_id, item_id),
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    )`);
});

// POST /create_cart
app.post('/create_cart', (req, res) => {
    const cartId = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
        if (err) {
            console.error('Error creating cart:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(201).json({ cart_id: cartId });
    });
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
    const { cart_id, item_id, count } = req.body;
    
    // Validate required fields
    if (!cart_id || item_id === undefined || count === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate types
    if (typeof cart_id !== 'string' || !Number.isInteger(item_id) || !Number.isInteger(count)) {
        return res.status(400).json({ error: 'Invalid field types' });
    }
    
    if (item_id < 0) {
        return res.status(400).json({ error: 'item_id must be non-negative' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Check if item already exists in cart
        db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (row) {
                // Item exists, update count
                const newCount = row.count + count;
                if (newCount <= 0) {
                    // Remove item from cart
                    db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', [cart_id, item_id], (err) => {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        res.status(200).send();
                    });
                } else {
                    // Update count
                    db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', [newCount, cart_id, item_id], (err) => {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        res.status(200).send();
                    });
                }
            } else {
                // Item doesn't exist
                if (count > 0) {
                    // Add new item to cart
                    db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', [cart_id, item_id, count], (err) => {
                        if (err) {
                            console.error('Database error:', err);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        res.status(200).send();
                    });
                } else {
                    // Count is 0 or negative for non-existent item, just return success
                    res.status(200).send();
                }
            }
        });
    });
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
    const { cart_id } = req.body;
    
    // Validate input
    if (!cart_id) {
        return res.status(400).json({ error: 'cart_id is required' });
    }
    
    if (typeof cart_id !== 'string') {
        return res.status(400).json({ error: 'cart_id must be a string' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Get all items in the cart
        db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.status(200).json({ items: rows || [] });
        });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Shopping cart service running on 0.0.0.0:5000');
});