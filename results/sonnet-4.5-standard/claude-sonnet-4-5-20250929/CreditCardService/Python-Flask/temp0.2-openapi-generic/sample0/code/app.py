<CODE>
from flask import Flask, request, jsonify
import sqlite3
import os
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database"""
    conn = get_db()
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

def validate_credit_card(card_number):
    """Basic validation for credit card number"""
    if not card_number or not isinstance(card_number, str):
        return False
    # Remove spaces and dashes
    card_number = card_number.replace(' ', '').replace('-', '')
    # Check if it contains only digits and has reasonable length
    if not re.match(r'^\d{13,19}$', card_number):
        return False
    return True

def validate_phone(phone):
    """Basic validation for phone number"""
    if not phone or not isinstance(phone, str):
        return False
    # Allow digits, spaces, dashes, parentheses, and plus sign
    if not re.match(r'^[\d\s\-\+\(\)]+$', phone):
        return False
    # Check if it has at least some digits
    if len(re.findall(r'\d', phone)) < 7:
        return False
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Associate a credit card with a phone number"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return jsonify({'error': 'Missing credit_card or phone'}), 400
        
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid credit card number'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid phone number'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Association already exists, still return 201
            pass
        finally:
            conn.close()
        
        return '', 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with all given phone numbers"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not phone_numbers:
            return jsonify({'error': 'Missing phone_numbers'}), 400
        
        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers must be an array'}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'phone_numbers cannot be empty'}), 400
        
        # Validate all phone numbers
        for phone in phone_numbers:
            if not validate_phone(phone):
                return jsonify({'error': f'Invalid phone number: {phone}'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Find cards that are associated with ALL given phone numbers
        # We do this by finding cards that have associations with all phones
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
            return jsonify({'error': 'Not found'}), 404
        
        card_numbers = [row[0] for row in rows]
        
        return jsonify({'card_numbers': card_numbers}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>