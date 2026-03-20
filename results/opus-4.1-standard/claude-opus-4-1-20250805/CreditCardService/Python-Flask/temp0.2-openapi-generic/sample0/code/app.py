import sqlite3
import json
import re
import hashlib
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_hash TEXT NOT NULL,
            phone_hash TEXT NOT NULL,
            UNIQUE(card_hash, phone_hash)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_phone_hash ON card_phone_associations(phone_hash)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_card_hash ON card_phone_associations(card_hash)')
    conn.commit()
    conn.close()

def hash_value(value):
    """Hash sensitive data using SHA-256"""
    salt = app.config['SECRET_KEY']
    return hashlib.sha256((value + salt).encode()).hexdigest()

def validate_credit_card(card_number):
    """Basic credit card validation"""
    # Remove spaces and dashes
    card_number = re.sub(r'[\s-]', '', card_number)
    
    # Check if it contains only digits
    if not card_number.isdigit():
        return False
    
    # Check length (most cards are 13-19 digits)
    if len(card_number) < 13 or len(card_number) > 19:
        return False
    
    # Luhn algorithm validation
    def luhn_check(card_num):
        digits = [int(d) for d in card_num]
        checksum = 0
        for i in range(len(digits) - 2, -1, -2):
            digits[i] *= 2
            if digits[i] > 9:
                digits[i] -= 9
        return sum(digits) % 10 == 0
    
    return luhn_check(card_number)

def validate_phone(phone_number):
    """Basic phone number validation"""
    # Remove common formatting characters
    phone_number = re.sub(r'[\s\-\(\)\+]', '', phone_number)
    
    # Check if it contains only digits
    if not phone_number.isdigit():
        return False
    
    # Check length (international numbers can be 7-15 digits)
    if len(phone_number) < 7 or len(phone_number) > 15:
        return False
    
    return True

def normalize_credit_card(card_number):
    """Normalize credit card number"""
    return re.sub(r'[\s-]', '', card_number)

def normalize_phone(phone_number):
    """Normalize phone number"""
    return re.sub(r'[\s\-\(\)\+]', '', phone_number)

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        credit_card = data.get('credit_card', '').strip()
        phone = data.get('phone', '').strip()
        
        # Validate required fields
        if not credit_card or not phone:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Normalize inputs
        credit_card = normalize_credit_card(credit_card)
        phone = normalize_phone(phone)
        
        # Validate credit card
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid credit card number'}), 400
        
        # Validate phone
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid phone number'}), 400
        
        # Hash the sensitive data
        card_hash = hash_value(credit_card)
        phone_hash = hash_value(phone)
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO card_phone_associations (card_hash, phone_hash)
                VALUES (?, ?)
            ''', (card_hash, phone_hash))
            conn.commit()
            return jsonify({'message': 'Association created successfully'}), 201
        except sqlite3.IntegrityError:
            # Association already exists
            return jsonify({'message': 'Association already exists'}), 201
        finally:
            conn.close()
            
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        phone_numbers = data.get('phone_numbers', [])
        
        # Validate required fields
        if not phone_numbers or not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers must be a non-empty array'}), 400
        
        # Normalize and validate phone numbers
        normalized_phones = []
        for phone in phone_numbers:
            if not isinstance(phone, str):
                return jsonify({'error': 'All phone numbers must be strings'}), 400
            
            phone = phone.strip()
            normalized_phone = normalize_phone(phone)
            
            if not validate_phone(normalized_phone):
                return jsonify({'error': f'Invalid phone number: {phone}'}), 400
            
            normalized_phones.append(normalized_phone)
        
        # Remove duplicates
        normalized_phones = list(set(normalized_phones))
        
        # Hash phone numbers
        phone_hashes = [hash_value(phone) for phone in normalized_phones]
        
        # Query database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query to find cards associated with ALL given phone numbers
        placeholders = ','.join(['?' for _ in phone_hashes])
        query = f'''
            SELECT card_hash
            FROM card_phone_associations
            WHERE phone_hash IN ({placeholders})
            GROUP BY card_hash
            HAVING COUNT(DISTINCT phone_hash) = ?
        '''
        
        cursor.execute(query, phone_hashes + [len(phone_hashes)])
        results = cursor.fetchall()
        conn.close()
        
        if not results:
            return jsonify({'error': 'No cards found for the given phone numbers'}), 404
        
        # Since we're storing hashes, we can't return the actual card numbers
        # In a real system, you'd need to store encrypted cards or use tokenization
        # For this implementation, we'll return the hashes as identifiers
        card_identifiers = [row[0] for row in results]
        
        return jsonify({'card_numbers': card_identifiers}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)