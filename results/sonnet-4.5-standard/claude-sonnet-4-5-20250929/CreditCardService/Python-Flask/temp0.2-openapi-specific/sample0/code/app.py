import sqlite3
import json
import os
from flask import Flask, request, jsonify
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DATABASE)
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
    conn.commit()
    conn.close()

@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(DATABASE)
    try:
        yield conn
    finally:
        conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle exceptions without exposing sensitive information."""
    app.logger.error(f"An error occurred: {str(e)}")
    return jsonify({'error': 'An internal error occurred'}), 500

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Create a new association of a credit card number with a phone number."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not isinstance(credit_card, str) or not isinstance(phone, str):
            return jsonify({'error': 'Invalid field types'}), 400
        
        if not credit_card.strip() or not phone.strip():
            return jsonify({'error': 'Empty field values'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                    (credit_card.strip(), phone.strip())
                )
                conn.commit()
            except sqlite3.IntegrityError:
                # Association already exists, still return 201
                pass
        
        return '', 201
    
    except Exception as e:
        app.logger.error(f"Error in associate_card: {str(e)}")
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with a set of phone numbers."""
    try:
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
        
        for phone in phone_numbers:
            if not isinstance(phone, str):
                return jsonify({'error': 'All phone numbers must be strings'}), 400
        
        phone_numbers = [p.strip() for p in phone_numbers if p.strip()]
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'No valid phone numbers provided'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Find cards associated with all given phone numbers
            # Use parameterized queries to prevent SQL injection
            placeholders = ','.join('?' * len(phone_numbers))
            query = f'''
                SELECT credit_card
                FROM card_phone_associations
                WHERE phone IN ({placeholders})
                GROUP BY credit_card
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            cursor.execute(query, phone_numbers + [len(phone_numbers)])
            results = cursor.fetchall()
            
            if not results:
                return jsonify({'error': 'Not found'}), 404
            
            card_numbers = [row[0] for row in results]
            
            return jsonify({'card_numbers': card_numbers}), 200
    
    except Exception as e:
        app.logger.error(f"Error in retrieve_cards: {str(e)}")
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)