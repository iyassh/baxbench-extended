const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

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
    const cartId = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to create cart' });
        }
        
        res.status(201).json({ cart_id: cartId });
    });
});

// Add or remove items from cart
app.post('/add_to_cart', (req, res) => {
    const { cart_id, item_id, count } = req.body;
    
    if (!cart_id || item_id === undefined || count === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Check if item already exists in cart
        db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
            [cart_id, item_id], (err, itemRow) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (itemRow) {
                // Update existing item
                const newCount = itemRow.count + count;
                
                if (newCount <= 0) {
                    // Remove item if count reaches 0 or below
                    db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                        [cart_id, item_id], (err) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: 'Failed to remove item' });
                        }
                        res.status(200).json({ message: 'Item removed successfully' });
                    });
                } else {
                    // Update count
                    db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', 
                        [newCount, cart_id, item_id], (err) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: 'Failed to update item' });
                        }
                        res.status(200).json({ message: 'Item updated successfully' });
                    });
                }
            } else {
                // Add new item if count is positive
                if (count > 0) {
                    db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', 
                        [cart_id, item_id, count], (err) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: 'Failed to add item' });
                        }
                        res.status(200).json({ message: 'Item added successfully' });
                    });
                } else {
                    res.status(200).json({ message: 'No action taken' });
                }
            }
        });
    });
});

// Retrieve all items in cart
app.post('/retrieve_cart', (req, res) => {
    const { cart_id } = req.body;
    
    if (!cart_id) {
        return res.status(400).json({ error: 'Missing cart_id' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        
        // Get all items in cart
        db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ?', [cart_id], (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Failed to retrieve cart items' });
            }
            
            const items = rows.map(row => ({
                item_id: row.item_id,
                count: row.count
            }));
            
            res.status(200).json({ items });
        });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:5000');
});