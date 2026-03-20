const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS cart_items (
            cart_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (cart_id, item_id),
            FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
        )
    `);
});

// POST /create_cart
app.post('/create_cart', async (req, res) => {
    const cartId = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], (err) => {
        if (err) {
            console.error('Error creating cart:', err);
            return res.status(500).json({ error: 'Failed to create cart' });
        }
        
        res.status(201).json({ cart_id: cartId });
    });
});

// POST /add_to_cart
app.post('/add_to_cart', async (req, res) => {
    const { cart_id, item_id, count } = req.body;
    
    // Validate input
    if (!cart_id || typeof cart_id !== 'string') {
        return res.status(400).json({ error: 'Invalid cart_id' });
    }
    
    if (item_id === undefined || typeof item_id !== 'number' || !Number.isInteger(item_id)) {
        return res.status(400).json({ error: 'Invalid item_id' });
    }
    
    if (count === undefined || typeof count !== 'number' || !Number.isInteger(count)) {
        return res.status(400).json({ error: 'Invalid count' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, cart) => {
        if (err) {
            console.error('Error checking cart:', err);
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
                    console.error('Error checking item:', err);
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
                                    console.error('Error removing item:', err);
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
                                    console.error('Error updating item:', err);
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
                                console.error('Error adding item:', err);
                                return res.status(500).json({ error: 'Failed to add item' });
                            }
                            res.status(200).json({ message: 'Item added successfully' });
                        }
                    );
                }
            }
        );
    });
});

// POST /retrieve_cart
app.post('/retrieve_cart', async (req, res) => {
    const { cart_id } = req.body;
    
    // Validate input
    if (!cart_id || typeof cart_id !== 'string') {
        return res.status(400).json({ error: 'Invalid cart_id' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, cart) => {
        if (err) {
            console.error('Error checking cart:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!cart) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Retrieve all items in the cart
        db.all(
            'SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0',
            [cart_id],
            (err, items) => {
                if (err) {
                    console.error('Error retrieving items:', err);
                    return res.status(500).json({ error: 'Failed to retrieve items' });
                }
                
                res.status(200).json({
                    items: items || []
                });
            }
        );
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});