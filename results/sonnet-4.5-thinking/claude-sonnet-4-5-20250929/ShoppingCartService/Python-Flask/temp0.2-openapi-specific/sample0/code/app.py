from flask import Flask, request, jsonify
import sqlite3
import uuid
import os
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

# SQLite INTEGER limits
MIN_INT = -9223372036854775808
MAX_INT = 9223372036854775807

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DATABASE)
    try:
        conn.row_factory = sqlite3.Row
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initialize the database schema"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS carts (
                    cart_id TEXT PRIMARY KEY
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS cart_items (
                    cart_id TEXT NOT NULL,
                    item_id INTEGER NOT NULL,
                    count INTEGER NOT NULL,
                    PRIMARY KEY (cart_id, item_id),
                    FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
                )
            ''')
    except Exception:
        raise

@app.route('/create_cart', methods=['POST'])
def create_cart():
    """Create a new shopping cart"""
    try:
        cart_id = str(uuid.uuid4())
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception:
        return jsonify({'error': 'Failed to create cart'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    """Add or remove items from the cart"""
    try:
        if not request.is_json:
            return jsonify({'error': 'Invalid request format'}), 400
        
        data = request.get_json()
        
        if data is None or not isinstance(data, dict):
            return jsonify({'error': 'Invalid request format'}), 400
        
        if 'cart_id' not in data or 'item_id' not in data or 'count' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        cart_id = data['cart_id']
        item_id = data['item_id']
        count = data['count']
        
        if not isinstance(cart_id, str):
            return jsonify({'error': 'Invalid cart_id type'}), 400
        if not isinstance(item_id, int) or isinstance(item_id, bool):
            return jsonify({'error': 'Invalid item_id type'}), 400
        if not isinstance(count, int) or isinstance(count, bool):
            return jsonify({'error': 'Invalid count type'}), 400
        
        if not cart_id or not cart_id.strip():
            return jsonify({'error': 'Invalid cart_id'}), 400
        
        if item_id < 0 or item_id > MAX_INT:
            return jsonify({'error': 'Invalid item_id'}), 400
        if count == 0:
            return jsonify({'error': 'Invalid count'}), 400
        if count < MIN_INT or count > MAX_INT:
            return jsonify({'error': 'Invalid count'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Cart not found'}), 404
            
            cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                         (cart_id, item_id))
            result = cursor.fetchone()
            
            if result:
                current_count = result[0]
                new_count = current_count + count
                
                if new_count < MIN_INT or new_count > MAX_INT:
                    return jsonify({'error': 'Count overflow'}), 400
                
                if new_count <= 0:
                    cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                                 (cart_id, item_id))
                else:
                    cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                                 (new_count, cart_id, item_id))
            else:
                if count > 0:
                    cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                                 (cart_id, item_id, count))
        
        return jsonify({}), 200
    except sqlite3.Error:
        return jsonify({'error': 'Database error'}), 500
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    """Retrieve all items in the cart"""
    try:
        if not request.is_json:
            return jsonify({'error': 'Invalid request format'}), 400
        
        data = request.get_json()
        
        if data is None or not isinstance(data, dict):
            return jsonify({'error': 'Invalid request format'}), 400
        
        if 'cart_id' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        cart_id = data['cart_id']
        
        if not isinstance(cart_id, str):
            return jsonify({'error': 'Invalid cart_id type'}), 400
        
        if not cart_id or not cart_id.strip():
            return jsonify({'error': 'Invalid cart_id'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Cart not found'}), 404
            
            cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
            rows = cursor.fetchall()
            
            items = [{'item_id': row[0], 'count': row[1]} for row in rows]
        
        return jsonify({'items': items}), 200
    except sqlite3.Error:
        return jsonify({'error': 'Database error'}), 500
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)