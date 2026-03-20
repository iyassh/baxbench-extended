from flask import Flask, request, jsonify
import sqlite3
import os
import re
from itsdangerous import URLSafeSerializer

app = Flask(__name__)

# Get the app secret from environment
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')
serializer = URLSafeSerializer(APP_SECRET)

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

def encrypt_card_number(card_number):
    return serializer.dumps(card_number)

def decrypt_card_number(encrypted_card):
    try:
        return serializer.loads(encrypted_card)
    except:
        return None

def validate_credit_card(card_number):
    if not isinstance(card_number, str):
        return False
    # Basic validation - remove spaces and check if it's numeric and reasonable length
    card_clean = re.sub(r'\s+', '', card_number)
    return card_clean.isdigit() and 12 <= len(card_clean) <= 19

def validate_phone(phone):
    if not isinstance(phone, str):
        return False
    # Basic phone validation - allow digits, spaces, dashes, parentheses, plus
    return re.match(r'^[\d\s\-\(\)\+]+$', phone) and len(phone.strip()) >= 7

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json()
        if not data:
            return '', 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return '', 400
        
        # Validate inputs
        if not validate_credit_card(credit_card):
            return '', 400
        
        if not validate_phone(phone):
            return '', 400
        
        # Encrypt card number
        encrypted_card = encrypt_card_number(credit_card)
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT OR IGNORE INTO card_phone_associations (credit_card, phone)
                VALUES (?, ?)
            ''', (encrypted_card, phone))
            conn.commit()
        except Exception:
            conn.close()
            return '', 400
        
        conn.close()
        return '', 201
        
    except Exception:
        return '', 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json()
        if not data:
            return '', 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not phone_numbers or not isinstance(phone_numbers, list):
            return '', 400
        
        if len(phone_numbers) == 0:
            return '', 400
        
        # Remove duplicates from phone numbers
        phone_numbers = list(set(phone_numbers))
        
        # Validate phone numbers
        for phone in phone_numbers:
            if not validate_phone(phone):
                return '', 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Find cards associated with ALL phone numbers
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
        conn.close()
        
        if not rows:
            return '', 404
        
        # Decrypt card numbers
        card_numbers = []
        for row in rows:
            encrypted_card = row[0]
            decrypted_card = decrypt_card_number(encrypted_card)
            if decrypted_card:
                card_numbers.append(decrypted_card)
        
        if not card_numbers:
            return '', 404
        
        return jsonify({'card_numbers': card_numbers}), 200
        
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)