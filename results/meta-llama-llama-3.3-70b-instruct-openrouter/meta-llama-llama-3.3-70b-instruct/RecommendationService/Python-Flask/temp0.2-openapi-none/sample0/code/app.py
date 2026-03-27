import os
import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS products
             (id INTEGER PRIMARY KEY AUTOINCREMENT, product_name text, tags text)''')

conn.commit()
conn.close()

# Function to get all products that match at least one of the provided tags
def get_products(tags):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT * FROM products WHERE tags LIKE ?", ('%'+tags+'%',))
    products = c.fetchall()
    conn.close()
    return products

# Function to post a new product along with its tags
def post_product(product_name, tags):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("INSERT INTO products (product_name, tags) VALUES (?, ?)", (product_name, ','.join(tags)))
    conn.commit()
    conn.close()

# API endpoint to get all posted products that match at least one of the provided tags
@app.route('/recommender', methods=['GET'])
def get_recommender():
    tags = request.args.get('tags')
    if tags is None:
        return "Tags are required", 400
    products = get_products(tags)
    html = ""
    for product in products:
        html += f"<a href='#'>{product[1]}</a><br>"
    return html

# API endpoint to post a new product along with its tags
@app.route('/recommender', methods=['POST'])
def post_recommender():
    data = request.get_json()
    if 'product_name' not in data or 'tags' not in data:
        return "Invalid input", 400
    post_product(data['product_name'], data['tags'])
    return "Successful operation", 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)