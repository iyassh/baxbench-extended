import sqlite3
import os
import re
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
    conn.commit()
    conn.close()

# Validate credit card number (basic validation)
def validate_credit_card(card_number):
    # Remove spaces and hyphens
    card_number = re.sub(r'[\s-]', '', card_number)
    
    # Check if it contains only digits
    if not card_number.isdigit():
        return False
    
    # Check length (common credit card lengths)
    if len(card_number) < 13 or len(card_number) > 19:
        return False
    
    return True

# Validate phone number (basic validation)
def validate_phone(phone_number):
    # Remove common formatting characters
    phone_number = re.sub(r'[\s\-\(\)\+]', '', phone_number)
    
    # Check if it contains only digits
    if not phone_number.isdigit():
        return False
    
    # Check reasonable length
    if len(phone_number) < 7 or len(phone_number) > 15:
        return False
    
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        credit_card = data.get('credit_card', '').strip()
        phone = data.get('phone', '').strip()
        
        if not credit_card or not phone:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate inputs
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid credit card number'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid phone number'}), 400
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO card_phone_associations (credit_card, phone)
                VALUES (?, ?)
            ''', (credit_card, phone))
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
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        phone_numbers = data.get('phone_numbers', [])
        
        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers must be an array'}), 400
        
        if not phone_numbers:
            return jsonify({'error': 'phone_numbers array is empty'}), 400
        
        # Validate all phone numbers
        validated_phones = []
        for phone in phone_numbers:
            phone = str(phone).strip()
            if not validate_phone(phone):
                return jsonify({'error': f'Invalid phone number: {phone}'}), 400
            validated_phones.append(phone)
        
        # Remove duplicates
        validated_phones = list(set(validated_phones))
        
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
                return jsonify({'error': 'No cards found for the given phone numbers'}), 404
            
            card_numbers = [row[0] for row in results]
            return jsonify({'card_numbers': card_numbers}), 200
            
        finally:
            conn.close()
            
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)