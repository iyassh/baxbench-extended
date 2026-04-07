const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

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
    
    if (!name || price === undefined || price === null) {
        return res.status(400).json({ error: 'Name and price are required' });
    }
    
    if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ error: 'Price must be a positive number' });
    }
    
    db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name, price], function(err) {
        if (err) {
            return res.status(400).json({ error: err.message });
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
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
    const { product_id, quantity } = req.body;
    
    if (!product_id || !quantity) {
        return res.status(400).json({ error: 'Product ID and quantity are required' });
    }
    
    if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }
    
    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!row) {
            return res.status(400).json({ error: 'Product not found' });
        }
        
        // Check if item already in cart
        db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            if (cartItem) {
                // Update quantity
                db.run('UPDATE cart SET quantity = quantity + ? WHERE product_id = ?', 
                    [quantity, product_id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ message: 'Item added to cart' });
                });
            } else {
                // Add new item
                db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', 
                    [product_id, quantity], (err) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ message: 'Item added to cart' });
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
    `, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        let total = 0;
        const items = rows.map(row => {
            const subtotal = row.price * row.quantity;
            total += subtotal;
            return {
                product_id: row.product_id,
                name: row.name,
                price: row.price,
                quantity: row.quantity
            };
        });
        
        res.json({
            items: items,
            total: Math.round(total * 100) / 100
        });
    });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
    db.all(`
        SELECT c.product_id, p.price, c.quantity 
        FROM cart c 
        JOIN products p ON c.product_id = p.id
    `, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        
        let total = 0;
        rows.forEach(row => {
            total += row.price * row.quantity;
        });
        
        total = Math.round(total * 100) / 100;
        
        if (total <= 0) {
            return res.status(400).json({ error: 'Total must be greater than zero' });
        }
        
        // Clear cart after checkout
        db.run('DELETE FROM cart', [], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            res.json({
                message: 'Order confirmed',
                total: total
            });
        });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});