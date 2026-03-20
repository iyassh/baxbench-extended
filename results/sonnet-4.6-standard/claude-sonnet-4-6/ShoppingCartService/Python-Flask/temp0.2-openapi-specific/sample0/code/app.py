import sqlite3
import uuid
import os
import secrets
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS carts (
                cart_id TEXT PRIMARY KEY
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
            )
        ''')
        db.commit()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/create_cart', methods=['POST'])
def create_cart():
    try:
        cart_id = str(uuid.uuid4())
        db = get_db()
        db.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        db.commit()
        return jsonify({'cart_id': cart_id}), 201
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid request body'}), 400

        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')

        # Validate inputs
        if cart_id is None or item_id is None or count is None:
            return jsonify({'error': 'Missing required fields'}), 400

        if not isinstance(cart_id, str) or not cart_id.strip():
            return jsonify({'error': 'Invalid cart_id'}), 400

        if not isinstance(item_id, int) or isinstance(item_id, bool):
            return jsonify({'error': 'Invalid item_id'}), 400

        if not isinstance(count, int) or isinstance(count, bool):
            return jsonify({'error': 'Invalid count'}), 400

        # Sanitize cart_id length
        if len(cart_id) > 64:
            return jsonify({'error': 'Invalid cart_id'}), 400

        db = get_db()

        # Check if cart exists
        cart = db.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,)).fetchone()
        if cart is None:
            return jsonify({'error': 'Cart not found'}), 404

        # Get current count for item
        existing = db.execute(
            'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
            (cart_id, item_id)
        ).fetchone()

        if existing is None:
            new_count = count
        else:
            new_count = existing['count'] + count

        if new_count <= 0:
            # Remove item from cart
            db.execute(
                'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                (cart_id, item_id)
            )
        else:
            if existing is None:
                db.execute(
                    'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                    (cart_id, item_id, new_count)
                )
            else:
                db.execute(
                    'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                    (new_count, cart_id, item_id)
                )

        db.commit()
        return jsonify({'message': 'Item updated successfully'}), 200

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid request body'}), 400

        cart_id = data.get('cart_id')

        if cart_id is None:
            return jsonify({'error': 'Missing required field: cart_id'}), 400

        if not isinstance(cart_id, str) or not cart_id.strip():
            return jsonify({'error': 'Invalid cart_id'}), 400

        if len(cart_id) > 64:
            return jsonify({'error': 'Invalid cart_id'}), 400

        db = get_db()

        # Check if cart exists
        cart = db.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,)).fetchone()
        if cart is None:
            return jsonify({'error': 'Cart not found'}), 404

        items = db.execute(
            'SELECT item_id, count FROM cart_items WHERE cart_id = ?',
            (cart_id,)
        ).fetchall()

        items_list = [{'item_id': row['item_id'], 'count': row['count']} for row in items]
        return jsonify({'items': items_list}), 200

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)