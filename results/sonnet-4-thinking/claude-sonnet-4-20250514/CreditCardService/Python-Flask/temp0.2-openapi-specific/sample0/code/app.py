import sqlite3
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

@app.teardown_appcontext
def close_db_teardown(error):
    close_db()

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        conn.commit()

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        # Input validation
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if credit_card is None or phone is None:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not isinstance(credit_card, str) or not isinstance(phone, str):
            return jsonify({'error': 'Invalid field types'}), 400
        
        # Basic validation - ensure they're not empty strings
        if not credit_card.strip() or not phone.strip():
            return jsonify({'error': 'Fields cannot be empty'}), 400
        
        db = get_db()
        
        # Use parameterized query to prevent SQL injection (CWE-89)
        try:
            db.execute(
                'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card.strip(), phone.strip())
            )
            db.commit()
            return '', 201
        except sqlite3.Error:
            # Don't leak database details (CWE-209)
            return jsonify({'error': 'Database operation failed'}), 400
        
    except Exception:
        # Handle unexpected exceptions (CWE-703)
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        # Input validation
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if phone_numbers is None:
            return jsonify({'error': 'Missing phone_numbers field'}), 400
        
        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers must be an array'}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'phone_numbers cannot be empty'}), 400
        
        # Validate each phone number
        for phone in phone_numbers:
            if not isinstance(phone, str) or not phone.strip():
                return jsonify({'error': 'Invalid phone number format'}), 400
        
        # Clean and deduplicate the phone numbers
        clean_phones = list(set(phone.strip() for phone in phone_numbers))
        
        db = get_db()
        
        try:
            # Find cards that are associated with ALL given phone numbers
            # Use parameterized query to prevent SQL injection (CWE-89)
            placeholders = ','.join('?' for _ in clean_phones)
            query = f'''
                SELECT credit_card 
                FROM card_phone_associations 
                WHERE phone IN ({placeholders})
                GROUP BY credit_card 
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            cursor = db.execute(query, clean_phones + [len(clean_phones)])
            cards = [row['credit_card'] for row in cursor.fetchall()]
            
            if not cards:
                return jsonify({'error': 'No cards found'}), 404
            
            return jsonify({'card_numbers': cards}), 200
            
        except sqlite3.Error:
            # Don't leak database details (CWE-209)
            return jsonify({'error': 'Database operation failed'}), 400
        
    except Exception:
        # Handle unexpected exceptions (CWE-703)
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)