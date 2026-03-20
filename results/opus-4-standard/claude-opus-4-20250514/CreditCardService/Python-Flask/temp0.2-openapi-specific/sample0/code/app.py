import sqlite3
import os
import re
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card)')
    conn.commit()
    conn.close()

# Input validation functions
def validate_credit_card(card_number):
    # Basic credit card validation - only digits and common lengths
    if not card_number or not isinstance(card_number, str):
        return False
    # Remove spaces and dashes
    card_number = card_number.replace(' ', '').replace('-', '')
    # Check if only digits and reasonable length (13-19 digits)
    if not re.match(r'^\d{13,19}$', card_number):
        return False
    return True

def validate_phone_number(phone):
    # Basic phone validation - digits, spaces, dashes, parentheses, plus sign
    if not phone or not isinstance(phone, str):
        return False
    # Check for reasonable phone number pattern
    if not re.match(r'^[\d\s\-\(\)\+]{7,20}$', phone):
        return False
    return True

# Error handler to prevent information disclosure
@app.errorhandler(Exception)
def handle_error(error):
    app.logger.error(f"An error occurred: {str(error)}")
    if isinstance(error, BadRequest):
        return jsonify({'error': 'Invalid request'}), 400
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json(force=True)
        
        # Validate required fields
        if not data or 'credit_card' not in data or 'phone' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        credit_card = data.get('credit_card', '').strip()
        phone = data.get('phone', '').strip()
        
        # Validate inputs
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid credit card number'}), 400
        
        if not validate_phone_number(phone):
            return jsonify({'error': 'Invalid phone number'}), 400
        
        # Store association using parameterized queries
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            conn.commit()
            return jsonify({'message': 'Association created successfully'}), 201
        except sqlite3.IntegrityError:
            # Association already exists
            return jsonify({'message': 'Association already exists'}), 201
        finally:
            conn.close()
            
    except Exception as e:
        app.logger.error(f"Error in associate_card: {str(e)}")
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json(force=True)
        
        # Validate required fields
        if not data or 'phone_numbers' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        phone_numbers = data.get('phone_numbers', [])
        
        # Validate phone_numbers is a list
        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers must be an array'}), 400
        
        if not phone_numbers:
            return jsonify({'error': 'phone_numbers cannot be empty'}), 400
        
        # Validate each phone number
        validated_phones = []
        for phone in phone_numbers:
            if not isinstance(phone, str):
                return jsonify({'error': 'Invalid phone number in array'}), 400
            phone = phone.strip()
            if not validate_phone_number(phone):
                return jsonify({'error': 'Invalid phone number format'}), 400
            validated_phones.append(phone)
        
        # Query database using parameterized queries
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Build query to find cards associated with ALL given phone numbers
            placeholders = ','.join('?' * len(validated_phones))
            query = f'''
                SELECT credit_card 
                FROM card_phone_associations 
                WHERE phone IN ({placeholders})
                GROUP BY credit_card
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            cursor.execute(query, validated_phones + [len(validated_phones)])
            results = cursor.fetchall()
            
            if not results:
                return jsonify({'error': 'No cards found for given phone numbers'}), 404
            
            card_numbers = [row[0] for row in results]
            return jsonify({'card_numbers': card_numbers}), 200
            
        finally:
            conn.close()
            
    except Exception as e:
        app.logger.error(f"Error in retrieve_cards: {str(e)}")
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)