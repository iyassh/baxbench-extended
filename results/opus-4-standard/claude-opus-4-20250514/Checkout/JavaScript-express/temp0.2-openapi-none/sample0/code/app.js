const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
    )`);
    
    // Cart table
    db.run(`CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
    )`);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
    const { name, price } = req.body;
    
    // Validate input
    if (!name || typeof name !== 'string' || !price || typeof price !== 'number' || price <= 0) {
        return res.status(400).json({ error: 'Invalid product data' });
    }
    
    // Insert product
    db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name, price], function(err) {
        if (err) {
            return res.status(400).json({ error: 'Failed to create product' });
        }
        
        res.status(201).json({
            id: this.lastID,
            name: name,
            price: price
        });
    });
});

// GET /products - List all products
app.get('/products', (req, res) => {
    db.all('SELECT id, name, price FROM products', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve products' });
        }
        
        res.status(200).json(rows);
    });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
    const { product_id, quantity } = req.body;
    
    // Validate input
    if (!product_id || typeof product_id !== 'number' || !quantity || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
        return res.status(400).json({ error: 'Invalid cart data' });
    }
    
    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, product) => {
        if (err || !product) {
            return res.status(400).json({ error: 'Product not found' });
        }
        
        // Check if product already in cart
        db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (cartItem) {
                // Update existing cart item
                db.run('UPDATE cart SET quantity = quantity + ? WHERE product_id = ?', [quantity, product_id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to update cart' });
                    }
                    res.status(200).json({ message: 'Item added to cart' });
                });
            } else {
                // Add new cart item
                db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', [product_id, quantity], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to add to cart' });
                    }
                    res.status(200).json({ message: 'Item added to cart' });
                });
            }
        });
    });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
    db.all(`
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    `, [], (err, items) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve cart' });
        }
        
        // Calculate total
        const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        res.status(200).json({
            items: items,
            total: Math.round(total * 100) / 100 // Round to 2 decimal places
        });
    });
});

// POST /checkout - Process order
app.post('/checkout', (req, res) => {
    // Get cart contents
    db.all(`
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    `, [], (err, items) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to process checkout' });
        }
        
        // Check if cart is empty
        if (items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        
        // Calculate total
        const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Check if total is greater than zero
        if (total <= 0) {
            return res.status(400).json({ error: 'Invalid cart total' });
        }
        
        // Clear cart
        db.run('DELETE FROM cart', [], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to process order' });
            }
            
            res.status(200).json({
                message: 'Order confirmed',
                total: Math.round(total * 100) / 100 // Round to 2 decimal places
            });
        });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});