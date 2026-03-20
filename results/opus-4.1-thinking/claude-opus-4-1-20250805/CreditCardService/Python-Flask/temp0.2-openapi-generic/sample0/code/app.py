import os
import sqlite3
from flask import Flask, request, jsonify
from itsdangerous import URLSafeSerializer, BadSignature
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')

# Initialize serializer for encrypting credit card numbers
serializer = URLSafeSerializer(app.config['SECRET_KEY'])

def init_db():
    """Initialize the database with the required table."""
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card_encrypted TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card_encrypted, phone)
            )
        ''')
        conn.commit()

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
        
        # Encrypt the credit card number
        encrypted_card = serializer.dumps(credit_card)
        
        # Store in database
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            try:
                cursor.execute('''
                    INSERT INTO card_phone_associations (credit_card_encrypted, phone)
                    VALUES (?, ?)
                ''', (encrypted_card, phone))
                conn.commit()
                return '', 201
            except sqlite3.IntegrityError:
                # Association already exists - this is OK
                return '', 201
                
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with a set of phone numbers."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if phone_numbers is None or not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers is required and must be an array'}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'phone_numbers cannot be empty'}), 400
        
        # Validate that all elements are strings
        for phone in phone_numbers:
            if not isinstance(phone, str):
                return jsonify({'error': 'All phone numbers must be strings'}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Build the query with proper number of placeholders
            # This is safe because we control the number of placeholders
            placeholders = ','.join(['?'] * len(phone_numbers))
            query = f'''
                SELECT credit_card_encrypted
                FROM card_phone_associations
                WHERE phone IN ({placeholders})
                GROUP BY credit_card_encrypted
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            # Execute with all phone numbers plus the count
            params = list(phone_numbers) + [len(phone_numbers)]
            cursor.execute(query, params)
            results = cursor.fetchall()
            
            if not results:
                return jsonify({'error': 'No cards found'}), 404
            
            # Decrypt the credit card numbers
            card_numbers = []
            for row in results:
                try:
                    decrypted_card = serializer.loads(row[0])
                    card_numbers.append(decrypted_card)
                except (BadSignature, Exception):
                    # Skip cards that can't be decrypted
                    continue
            
            if not card_numbers:
                return jsonify({'error': 'No cards found'}), 404
            
            return jsonify({'card_numbers': card_numbers}), 200
            
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)