from flask import Flask, request, jsonify
import sqlite3
import uuid
import os
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        
        # Create carts table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS carts (
                cart_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create cart_items table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
            )
        ''')
        
        conn.commit()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Generic error handlers to avoid information disclosure
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/create_cart', methods=['POST'])
def create_cart():
    try:
        cart_id = str(uuid.uuid4())
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
            conn.commit()
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    try:
        # Content type validation
        if request.content_type != 'application/json':
            return jsonify({'error': 'Bad Request'}), 400
            
        data = request.get_json(force=False)
        
        # Input validation
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
            
        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')
        
        # Required fields validation
        if cart_id is None or item_id is None or count is None:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Type validation
        if not isinstance(cart_id, str) or not isinstance(item_id, int) or not isinstance(count, int):
            return jsonify({'error': 'Bad Request'}), 400
        
        # Range validation
        if len(cart_id) == 0 or len(cart_id) > 100:
            return jsonify({'error': 'Bad Request'}), 400
        if item_id < 0 or item_id > 2147483647:  # Max int value for SQLite
            return jsonify({'error': 'Bad Request'}), 400
        if abs(count) > 1000000:  # Reasonable limit
            return jsonify({'error': 'Bad Request'}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Not Found'}), 404
            
            # Check if item already exists in cart
            cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                         (cart_id, item_id))
            existing = cursor.fetchone()
            
            if existing:
                new_count = existing[0] + count
                if new_count <= 0:
                    # Remove item if count becomes 0 or negative
                    cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                                 (cart_id, item_id))
                else:
                    # Update count
                    cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', 
                                 (new_count, cart_id, item_id))
            else:
                if count > 0:
                    # Add new item
                    cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', 
                                 (cart_id, item_id, count))
            
            conn.commit()
        
        return jsonify({'message': 'Success'}), 200
        
    except (ValueError, TypeError, AttributeError):
        return jsonify({'error': 'Bad Request'}), 400
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    try:
        # Content type validation
        if request.content_type != 'application/json':
            return jsonify({'error': 'Bad Request'}), 400
            
        data = request.get_json(force=False)
        
        # Input validation
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
            
        cart_id = data.get('cart_id')
        
        # Required field validation
        if cart_id is None:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Type validation
        if not isinstance(cart_id, str):
            return jsonify({'error': 'Bad Request'}), 400
        
        # Range validation
        if len(cart_id) == 0 or len(cart_id) > 100:
            return jsonify({'error': 'Bad Request'}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Not Found'}), 404
            
            # Retrieve items
            cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id', 
                         (cart_id,))
            items = cursor.fetchall()
        
        items_list = [{'item_id': item[0], 'count': item[1]} for item in items]
        
        return jsonify({'items': items_list}), 200
        
    except (ValueError, TypeError, AttributeError):
        return jsonify({'error': 'Bad Request'}), 400
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)