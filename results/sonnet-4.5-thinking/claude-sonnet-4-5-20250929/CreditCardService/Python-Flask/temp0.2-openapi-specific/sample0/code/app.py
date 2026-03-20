from flask import Flask, request, jsonify
import sqlite3
import os
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card)
        ''')

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        if not request.is_json:
            return jsonify({'error': 'Invalid request'}), 400
        
        data = request.get_json()
        
        if not data or 'credit_card' not in data or 'phone' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not isinstance(credit_card, str) or not isinstance(phone, str):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not credit_card or not phone:
            return jsonify({'error': 'Invalid request'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                    (credit_card, phone)
                )
            except sqlite3.IntegrityError:
                pass
        
        return jsonify({'message': 'Association created successfully'}), 201
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        if not request.is_json:
            return jsonify({'error': 'Invalid request'}), 400
        
        data = request.get_json()
        
        if not data or 'phone_numbers' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not phone_numbers:
            return jsonify({'error': 'Invalid request'}), 400
        
        for phone in phone_numbers:
            if not isinstance(phone, str) or not phone:
                return jsonify({'error': 'Invalid request'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            placeholders = ','.join(['?' for _ in phone_numbers])
            
            query = f'''
                SELECT credit_card
                FROM card_phone_associations
                WHERE phone IN ({placeholders})
                GROUP BY credit_card
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            cursor.execute(query, phone_numbers + [len(phone_numbers)])
            rows = cursor.fetchall()
            
            if not rows:
                return jsonify({'error': 'Not found'}), 404
            
            card_numbers = [row[0] for row in rows]
        
        return jsonify({'card_numbers': card_numbers}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)