const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    // Create carts table
    db.run(`CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating carts table:', err.message);
        }
    });

    // Create cart_items table
    db.run(`CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cart_id TEXT,
        item_id INTEGER,
        count INTEGER,
        FOREIGN KEY (cart_id) REFERENCES carts (cart_id),
        UNIQUE(cart_id, item_id)
    )`, (err) => {
        if (err) {
            console.error('Error creating cart_items table:', err.message);
        }
    });
}

// POST /create_cart
app.post('/create_cart', (req, res) => {
    const cartId = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
        if (err) {
            console.error('Error creating cart:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(201).json({ cart_id: cartId });
    });
});

// POST /add_to_cart
app.post('/add_to_cart', (req, res) => {
    const { cart_id, item_id, count } = req.body;
    
    // Validate input
    if (!cart_id || typeof cart_id !== 'string') {
        return res.status(400).json({ error: 'Invalid cart_id' });
    }
    
    if (!Number.isInteger(item_id)) {
        return res.status(400).json({ error: 'Invalid item_id' });
    }
    
    if (!Number.isInteger(count)) {
        return res.status(400).json({ error: 'Invalid count' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error('Error checking cart:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Check if item already exists in cart
        db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
               [cart_id, item_id], (err, existingItem) => {
            if (err) {
                console.error('Error checking existing item:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (existingItem) {
                // Update existing item
                const newCount = existingItem.count + count;
                
                if (newCount <= 0) {
                    // Remove item if count becomes 0 or negative
                    db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                           [cart_id, item_id], (err) => {
                        if (err) {
                            console.error('Error removing item:', err.message);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        res.status(200).json({ message: 'Item removed successfully' });
                    });
                } else {
                    // Update item count
                    db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                           [newCount, cart_id, item_id], (err) => {
                        if (err) {
                            console.error('Error updating item:', err.message);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        res.status(200).json({ message: 'Item updated successfully' });
                    });
                }
            } else {
                // Add new item (only if count is positive)
                if (count <= 0) {
                    return res.status(400).json({ error: 'Cannot add item with non-positive count' });
                }
                
                db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                       [cart_id, item_id, count], (err) => {
                    if (err) {
                        console.error('Error adding item:', err.message);
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    res.status(200).json({ message: 'Item added successfully' });
                });
            }
        });
    });
});

// POST /retrieve_cart
app.post('/retrieve_cart', (req, res) => {
    const { cart_id } = req.body;
    
    // Validate input
    if (!cart_id || typeof cart_id !== 'string') {
        return res.status(400).json({ error: 'Invalid cart_id' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error('Error checking cart:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Retrieve all items in the cart
        db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
               [cart_id], (err, rows) => {
            if (err) {
                console.error('Error retrieving cart items:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            const items = rows.map(row => ({
                item_id: row.item_id,
                count: row.count
            }));
            
            res.status(200).json({ items });
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
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
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});