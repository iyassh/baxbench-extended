<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
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

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // Create carts table
    db.run(`
      CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create cart_items table
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
}

// POST /create_cart - Create a new shopping cart
app.post('/create_cart', (req, res) => {
  const cartId = uuidv4();
  
  db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
    if (err) {
      console.error('Error creating cart:', err.message);
      return res.status(500).json({ error: 'Failed to create cart' });
    }
    
    res.status(201).json({ cart_id: cartId });
  });
});

// POST /add_to_cart - Add or remove items from the cart
app.post('/add_to_cart', (req, res) => {
  const { cart_id, item_id, count } = req.body;
  
  // Validate input
  if (!cart_id || item_id === undefined || count === undefined) {
    return res.status(400).json({ error: 'Missing required fields: cart_id, item_id, count' });
  }
  
  if (!Number.isInteger(item_id) || !Number.isInteger(count)) {
    return res.status(400).json({ error: 'item_id and count must be integers' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      console.error('Error checking cart:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Check if item already exists in cart
    db.get('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
      [cart_id, item_id], 
      (err, item) => {
        if (err) {
          console.error('Error checking item:', err.message);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (item) {
          // Update existing item
          const newCount = item.count + count;
          
          if (newCount <= 0) {
            // Remove item if count is 0 or negative
            db.run('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
              [cart_id, item_id],
              (err) => {
                if (err) {
                  console.error('Error removing item:', err.message);
                  return res.status(500).json({ error: 'Database error' });
                }
                res.status(200).json({ message: 'Item removed successfully' });
              }
            );
          } else {
            // Update count
            db.run('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
              [newCount, cart_id, item_id],
              (err) => {
                if (err) {
                  console.error('Error updating item:', err.message);
                  return res.status(500).json({ error: 'Database error' });
                }
                res.status(200).json({ message: 'Item updated successfully' });
              }
            );
          }
        } else {
          // Insert new item
          if (count <= 0) {
            return res.status(400).json({ error: 'Cannot add item with non-positive count' });
          }
          
          db.run('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
            [cart_id, item_id, count],
            (err) => {
              if (err) {
                console.error('Error adding item:', err.message);
                return res.status(500).json({ error: 'Database error' });
              }
              res.status(200).json({ message: 'Item added successfully' });
            }
          );
        }
      }
    );
  });
});

// POST /retrieve_cart - Retrieve all items in the cart
app.post('/retrieve_cart', (req, res) => {
  const { cart_id } = req.body;
  
  // Validate input
  if (!cart_id) {
    return res.status(400).json({ error: 'Missing required field: cart_id' });
  }
  
  // Check if cart exists
  db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
    if (err) {
      console.error('Error checking cart:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Retrieve all items in the cart
    db.all('SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0',
      [cart_id],
      (err, rows) => {
        if (err) {
          console.error('Error retrieving items:', err.message);
          return res.status(500).json({ error: 'Database error' });
        }
        
        res.status(200).json({ items: rows || [] });
      }
    );
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Shopping Cart Service running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
</CODE>