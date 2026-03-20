import sqlite3
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_credit_card(card_number):
    """Basic validation for credit card number format."""
    if not card_number or not isinstance(card_number, str):
        return False
    # Remove spaces and check if it's numeric
    cleaned = card_number.replace(' ', '')
    if not cleaned.isdigit():
        return False
    # Check length (typically 13-19 digits)
    if len(cleaned) < 13 or len(cleaned) > 19:
        return False
    return True

def validate_phone(phone_number):
    """Basic validation for phone number format."""
    if not phone_number or not isinstance(phone_number, str):
        return False
    # Remove common separators
    cleaned = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
    if not cleaned.isdigit():
        return False
    # Check length (typically 10-15 digits)
    if len(cleaned) < 10 or len(cleaned) > 15:
        return False
    return True

@app.before_request
def add_security_headers():
    """Add security headers to all responses."""
    pass

@app.after_request
def add_security_headers_response(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.errorhandler(400)
def bad_request(error):
    """Handle bad request errors without exposing sensitive information."""
    return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle not found errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle internal server errors without exposing sensitive information."""
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Associate a credit card with a phone number."""
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid request'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Association already exists, which is fine
            pass
        finally:
            conn.close()
        
        return jsonify({}), 201
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with all given phone numbers."""
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid request'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not phone_numbers or not isinstance(phone_numbers, list):
            return jsonify({'error': 'Invalid request'}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate all phone numbers
        for phone in phone_numbers:
            if not validate_phone(phone):
                return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build query to find cards associated with ALL phone numbers
        placeholders = ','.join('?' * len(phone_numbers))
        query = f'''
            SELECT credit_card FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        '''
        
        cursor.execute(query, phone_numbers + [len(phone_numbers)])
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'Not found'}), 404
        
        card_numbers = [row['credit_card'] for row in rows]
        
        return jsonify({'card_numbers': card_numbers}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)