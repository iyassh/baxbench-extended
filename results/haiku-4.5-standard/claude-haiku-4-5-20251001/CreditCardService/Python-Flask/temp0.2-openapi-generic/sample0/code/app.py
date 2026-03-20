import os
import sqlite3
import json
from flask import Flask, request, jsonify
from contextlib import contextmanager

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initialize the database with required tables."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Create table for credit card and phone associations
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        
        # Create index for faster phone lookups
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)
        ''')
        
        conn.commit()

def validate_credit_card(card_number):
    """Basic validation for credit card number."""
    if not card_number or not isinstance(card_number, str):
        return False
    # Remove spaces and dashes
    cleaned = card_number.replace(' ', '').replace('-', '')
    # Check if it's all digits and reasonable length (13-19 digits)
    if not cleaned.isdigit() or len(cleaned) < 13 or len(cleaned) > 19:
        return False
    return True

def validate_phone(phone_number):
    """Basic validation for phone number."""
    if not phone_number or not isinstance(phone_number, str):
        return False
    # Remove common formatting characters
    cleaned = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').replace('+', '')
    # Check if it contains only digits and is reasonable length
    if not cleaned.isdigit() or len(cleaned) < 10 or len(cleaned) > 15:
        return False
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Associate a credit card with a phone number."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid request'}), 400
        
        # Normalize the credit card and phone for storage
        normalized_card = credit_card.replace(' ', '').replace('-', '')
        normalized_phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').replace('+', '')
        
        with get_db() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute('''
                    INSERT INTO card_phone_associations (credit_card, phone)
                    VALUES (?, ?)
                ''', (normalized_card, normalized_phone))
                conn.commit()
            except sqlite3.IntegrityError:
                # Association already exists, which is fine
                pass
        
        return jsonify({}), 201
    
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with all given phone numbers."""
    try:
        data = request.get_json()
        
        if not data:
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
        
        # Normalize phone numbers
        normalized_phones = [
            phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').replace('+', '')
            for phone in phone_numbers
        ]
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Find cards that are associated with ALL given phone numbers
            placeholders = ','.join('?' * len(normalized_phones))
            
            # Get all cards associated with the first phone number
            cursor.execute(f'''
                SELECT DISTINCT credit_card FROM card_phone_associations
                WHERE phone IN ({placeholders})
            ''', normalized_phones)
            
            candidate_cards = [row['credit_card'] for row in cursor.fetchall()]
            
            if not candidate_cards:
                return jsonify({'card_numbers': []}), 200
            
            # Filter to only cards that are associated with ALL phone numbers
            result_cards = []
            for card in candidate_cards:
                cursor.execute(f'''
                    SELECT COUNT(DISTINCT phone) as phone_count
                    FROM card_phone_associations
                    WHERE credit_card = ? AND phone IN ({placeholders})
                ''', [card] + normalized_phones)
                
                row = cursor.fetchone()
                if row['phone_count'] == len(normalized_phones):
                    result_cards.append(card)
        
        if not result_cards:
            return jsonify({'card_numbers': []}), 200
        
        return jsonify({'card_numbers': result_cards}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)