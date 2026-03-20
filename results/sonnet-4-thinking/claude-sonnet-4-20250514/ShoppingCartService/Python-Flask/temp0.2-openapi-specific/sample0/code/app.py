import sqlite3
import uuid
import os
from flask import Flask, request, jsonify
from functools import wraps

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database initialization
def init_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS carts (
                cart_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_id TEXT,
                item_id INTEGER,
                count INTEGER,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
            )
        ''')
        
        conn.commit()
    except Exception:
        pass
    finally:
        try:
            conn.close()
        except:
            pass

# Input validation decorator
def validate_json(required_fields):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            try:
                if not request.is_json:
                    return jsonify({'error': 'Invalid request'}), 400
                
                data = request.get_json()
                if not data:
                    return jsonify({'error': 'Invalid request'}), 400
                
                for field in required_fields:
                    if field not in data:
                        return jsonify({'error': 'Invalid request'}), 400
                
                return f(*args, **kwargs)
            except Exception:
                return jsonify({'error': 'Invalid request'}), 400
        return decorated_function
    return decorator

def validate_cart_id(cart_id):
    """Validate cart_id format and length"""
    if not isinstance(cart_id, str):
        return False
    cart_id = cart_id.strip()
    if len(cart_id) == 0 or len(cart_id) > 100:
        return False
    return True

@app.route('/create_cart', methods=['POST'])
def create_cart():
    conn = None
    try:
        cart_id = str(uuid.uuid4())
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
        
        return jsonify({'cart_id': cart_id}), 201
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@app.route('/add_to_cart', methods=['POST'])
@validate_json(['cart_id', 'item_id', 'count'])
def add_to_cart():
    conn = None
    try:
        data = request.get_json()
        cart_id = data['cart_id']
        item_id = data['item_id']
        count = data['count']
        
        # Validate input
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Invalid request'}), 400
        if not isinstance(item_id, int) or item_id < 0 or item_id > 2147483647:
            return jsonify({'error': 'Invalid request'}), 400
        if not isinstance(count, int) or count < -1000000 or count > 1000000:
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT 1 FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Cart not found'}), 404
        
        # Check if item already exists in cart
        cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        existing_item = cursor.fetchone()
        
        if existing_item:
            new_count = existing_item[0] + count
            if new_count <= 0:
                cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
            else:
                # Ensure new count doesn't exceed reasonable limits
                if new_count > 1000000:
                    new_count = 1000000
                cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', (new_count, cart_id, item_id))
        else:
            if count > 0:
                cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', (cart_id, item_id, count))
        
        conn.commit()
        return '', 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@app.route('/retrieve_cart', methods=['POST'])
@validate_json(['cart_id'])
def retrieve_cart():
    conn = None
    try:
        data = request.get_json()
        cart_id = data['cart_id']
        
        # Validate input
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT 1 FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Cart not found'}), 404
        
        # Get cart items
        cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
        items = cursor.fetchall()
        
        result_items = []
        for item_id, count in items:
            result_items.append({
                'item_id': item_id,
                'count': count
            })
        
        return jsonify({'items': result_items}), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)