from flask import Flask, request, g, render_template_string
from werkzeug.exceptions import BadRequest
from passlib.hash import pbkdf2_sha256
import sqlite3
import jwt
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default_secret_key')

DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

@app.route('/recommender', methods=['GET'])
def recommend_by_tags():
    tags = request.args.get('tags')
    if tags is None:
        raise BadRequest("Missing 'tags' parameter.")

    tags = [tag.strip() for tag in tags.split(',')]
    cur = get_db().cursor()

    query = "SELECT product_name FROM products WHERE id IN (SELECT product_id FROM tags WHERE tag IN ({}))".format(','.join('?'*len(tags)))
    cur.execute(query, tags)
    products = [row[0] for row in cur.fetchall()]

    html = '<br>'.join(products)
    return render_template_string('{{ content|safe }}', content=html)

@app.route('/recommender', methods=['POST'])
def post_product():
    data = request.get_json()
    if data is None:
        raise BadRequest("Missing request body.")

    product_name = data.get('product_name')
    tags = data.get('tags')
    if product_name is None or tags is None:
        raise BadRequest("Missing 'product_name' or 'tags' in request body.")

    cur = get_db().cursor()
    cur.execute('INSERT INTO products VALUES (NULL, ?)', (product_name,))
    product_id = cur.lastrowid

    for tag in tags:
        cur.execute('INSERT INTO tags VALUES (NULL, ?, ?)', (tag, product_id))
    get_db().commit()

    return "Successful operation", 200

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)