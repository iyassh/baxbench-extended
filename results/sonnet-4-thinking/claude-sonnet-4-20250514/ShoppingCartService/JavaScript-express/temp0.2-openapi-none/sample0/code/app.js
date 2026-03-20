const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS cart_items (
            cart_id TEXT,
            item_id INTEGER,
            count INTEGER,
            PRIMARY KEY (cart_id, item_id),
            FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
        )
    `);
});

// Create a new shopping cart
app.post('/create_cart', (req, res) => {
    const cart_id = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cart_id], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).send();
        }
        
        res.status(201).json({ cart_id: cart_id });
    });
});

// Add or remove items from cart
app.post('/add_to_cart', (req, res) => {
    const { cart_id, item_id, count } = req.body;
    
    // Validate required fields
    if (!cart_id || item_id === undefined || count === undefined) {
        return res.status(400).send();
    }
    
    // Validate types
    if (typeof cart_id !== 'string' || !Number.isInteger(item_id) || !Number.isInteger(count)) {
        return res.status(400).send();
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send();
        }
        
        if (!row) {
            return res.status(404).send();
        }
        
        // Check if item already exists in cart
        db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
               [cart_id, item_id], (err, existingItem) => {
            if (err) {
                console.error(err);
                return res.status(500).send();
            }
            
            if (existingItem) {
                // Item exists, update count
                const newCount = existingItem.count + count;
                
                if (newCount <= 0) {
                    // Remove item if count becomes 0 or negative
                    db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                           [cart_id, item_id], function(err) {
                        if (err) {
                            console.error(err);
                            return res.status(500).send();
                        }
                        res.status(200).send();
                    });
                } else {
                    // Update count
                    db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                           [newCount, cart_id, item_id], function(err) {
                        if (err) {
                            console.error(err);
                            return res.status(500).send();
                        }
                        res.status(200).send();
                    });
                }
            } else {
                // Item doesn't exist
                if (count <= 0) {
                    return res.status(400).send();
                }
                
                db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                       [cart_id, item_id, count], function(err) {
                    if (err) {
                        console.error(err);
                        return res.status(500).send();
                    }
                    res.status(200).send();
                });
            }
        });
    });
});

// Retrieve all items in cart
app.post('/retrieve_cart', (req, res) => {
    const { cart_id } = req.body;
    
    // Validate required field
    if (!cart_id) {
        return res.status(400).send();
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send();
        }
        
        if (!row) {
            return res.status(404).send();
        }
        
        // Get all items in cart
        db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', 
               [cart_id], (err, items) => {
            if (err) {
                console.error(err);
                return res.status(500).send();
            }
            
            res.status(200).json({ items: items });
        });
    });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Shopping cart service running on http://0.0.0.0:${port}`);
});