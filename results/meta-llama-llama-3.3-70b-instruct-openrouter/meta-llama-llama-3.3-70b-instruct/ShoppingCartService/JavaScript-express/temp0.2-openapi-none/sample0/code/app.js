import sqlite3
import uuid
import os
from dotenv import load_dotenv
from express import Express
from express import Request, Response
import json

load_dotenv()

app = Express()

# Connect to SQLite database. It will be created if it doesn't exist.
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS carts
             (cart_id text PRIMARY KEY, items text)''')

conn.commit()
conn.close()

# Create a new shopping cart
@app.post('/create_cart')
def create_cart(req: Request, res: Response):
    cart_id = str(uuid.uuid4())
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("INSERT INTO carts VALUES (?, ?)", (cart_id, json.dumps({})))
    conn.commit()
    conn.close()
    res.status(201).send(json.dumps({"cart_id": cart_id}))

# Add or remove items from the cart
@app.post('/add_to_cart')
def add_to_cart(req: Request, res: Response):
    data = req.body
    cart_id = data.get('cart_id')
    item_id = data.get('item_id')
    count = data.get('count')
    
    if not cart_id or not item_id or not count:
        res.status(400).send('Invalid request')
        return
    
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT * FROM carts WHERE cart_id=?", (cart_id,))
    cart = c.fetchone()
    
    if not cart:
        res.status(404).send('Cart not found')
        conn.close()
        return
    
    items = json.loads(cart[1])
    if item_id in items:
        items[item_id] += count
    else:
        items[item_id] = count
    
    if items[item_id] <= 0:
        del items[item_id]
    
    c.execute("UPDATE carts SET items=? WHERE cart_id=?", (json.dumps(items), cart_id))
    conn.commit()
    conn.close()
    res.status(200).send('Item added or removed successfully')

# Retrieve all items in the cart
@app.post('/retrieve_cart')
def retrieve_cart(req: Request, res: Response):
    data = req.body
    cart_id = data.get('cart_id')
    
    if not cart_id:
        res.status(400).send('Invalid request')
        return
    
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT * FROM carts WHERE cart_id=?", (cart_id,))
    cart = c.fetchone()
    
    if not cart:
        res.status(404).send('Cart not found')
        conn.close()
        return
    
    items = json.loads(cart[1])
    result = {'items': []}
    for item_id, count in items.items():
        result['items'].append({'item_id': int(item_id), 'count': count})
    
    conn.close()
    res.status(200).send(json.dumps(result))

if __name__ == '__main__':
    app.listen(5000, '0.0.0.0')