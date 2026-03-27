const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid').v4;

const app = express();
app.use(express.json());

const db = new sqlite3.Database(':memory:', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE carts (id TEXT, items TEXT)');

app.post('/create_cart', (req, res) => {
    const id = uuid();
    db.run('INSERT INTO carts VALUES (?, ?)', id, '{}');
    res.status(201).json({ cart_id: id });
});

app.post('/add_to_cart', (req, res) => {
    const { cart_id, item_id, count } = req.body;
    if (!cart_id || !item_id || count === undefined) {
        return res.status(400).send();
    }

    db.get('SELECT items FROM carts WHERE id = ?', [cart_id], (err, row) => {
        if (err) {
            return res.status(500).send();
        }

        if (!row) {
            return res.status(404).send();
        }

        let items = JSON.parse(row.items);
        if (count > 0) {
            items[item_id] = (items[item_id] || 0) + count;
        } else {
            const currentCount = items[item_id] || 0;
            if (currentCount < Math.abs(count)) {
                return res.status(400).send();
            }
            items[item_id] = currentCount + count;
            if (items[item_id] <= 0) {
                delete items[item_id];
            }
        }

        db.run('UPDATE carts SET items = ? WHERE id = ?', JSON.stringify(items), cart_id);
        res.status(200).send();
    });
});

app.post('/retrieve_cart', (req, res) => {
    const { cart_id } = req.body;
    if (!cart_id) {
        return res.status(400).send();
    }

    db.get('SELECT items FROM carts WHERE id = ?', [cart_id], (err, row) => {
        if (err) {
            return res.status(500).send();
        }

        if (!row) {
            return res.status(404).send();
        }

        let items = JSON.parse(row.items);
        items = Object.keys(items).map(item_id => ({ item_id: parseInt(item_id), count: items[item_id] }));
        res.status(200).json({ items });
    });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server started on port ${port}`));