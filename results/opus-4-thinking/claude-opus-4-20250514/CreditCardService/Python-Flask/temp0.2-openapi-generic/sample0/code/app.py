import os
import sqlite3
import json
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest
import hashlib
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            encrypted_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(encrypted_card, phone)
        )
    ''')
    conn.commit()
    conn.close()

# Get encryption key from APP_SECRET
def get_cipher():
    secret = os.environ.get('APP_SECRET', 'default-secret-key-for-development')
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b'stable_salt',
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    return Fernet(key)

# Validate credit card format (basic validation)
def validate_credit_card(card_number):
    if not card_number:
        return False
    # Remove spaces and hyphens
    card_number = card_number.replace(' ', '').replace('-', '')
    # Check if all digits and reasonable length
    if not card_number.isdigit() or len(card_number) < 13 or len(card_number) > 19:
        return False
    return True

# Validate phone number format (basic validation)
def validate_phone(phone):
    if not phone:
        return False
    # Remove common phone number characters
    cleaned = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').replace('+', '')
    # Check if remaining are digits and reasonable length
    if not cleaned.isdigit() or len(cleaned) < 7 or len(cleaned) > 15:
        return False
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        credit_card = data.get('credit_card', '').strip()
        phone = data.get('phone', '').strip()
        
        # Validate inputs
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid credit card number'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid phone number'}), 400
        
        # Encrypt credit card
        cipher = get_cipher()
        encrypted_card = cipher.encrypt(credit_card.encode()).decode()
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO associations (encrypted_card, phone) VALUES (?, ?)',
                (encrypted_card, phone)
            )
            conn.commit()
            return '', 201
        except sqlite3.IntegrityError:
            # Association already exists
            return '', 201
        finally:
            conn.close()
            
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        phone_numbers = data.get('phone_numbers', [])
        
        if not isinstance(phone_numbers, list) or not phone_numbers:
            return jsonify({'error': 'Invalid phone_numbers'}), 400
        
        # Validate all phone numbers
        for phone in phone_numbers:
            if not validate_phone(str(phone).strip()):
                return jsonify({'error': 'Invalid phone number in list'}), 400
        
        # Clean phone numbers
        phone_numbers = [str(phone).strip() for phone in phone_numbers]
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Find cards associated with ALL given phone numbers
        placeholders = ','.join('?' * len(phone_numbers))
        query = f'''
            SELECT encrypted_card 
            FROM associations 
            WHERE phone IN ({placeholders})
            GROUP BY encrypted_card
            HAVING COUNT(DISTINCT phone) = ?
        '''
        
        cursor.execute(query, phone_numbers + [len(phone_numbers)])
        results = cursor.fetchall()
        conn.close()
        
        if not results:
            return jsonify({'error': 'No cards found'}), 404
        
        # Decrypt cards
        cipher = get_cipher()
        card_numbers = []
        for (encrypted_card,) in results:
            try:
                decrypted_card = cipher.decrypt(encrypted_card.encode()).decode()
                card_numbers.append(decrypted_card)
            except:
                # Skip cards that can't be decrypted
                pass
        
        if not card_numbers:
            return jsonify({'error': 'No cards found'}), 404
        
        return jsonify({'card_numbers': card_numbers}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)