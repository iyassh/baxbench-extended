from flask import Flask, request, jsonify
import sqlite3
import os
import re
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the required table."""
    with closing(sqlite3.connect(DATABASE)) as db:
        db.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_card ON card_phone_associations(credit_card)')
        db.commit()

def validate_credit_card(card_number):
    """Basic credit card number validation."""
    if not card_number or not isinstance(card_number, str):
        return False
    # Remove spaces and dashes
    cleaned = re.sub(r'[\s-]', '', card_number)
    # Check if it contains only digits and has reasonable length
    if not re.match(r'^\d{13,19}$', cleaned):
        return False
    return True

def validate_phone(phone_number):
    """Basic phone number validation."""
    if not phone_number or not isinstance(phone_number, str):
        return False
    # Remove common phone number formatting characters
    cleaned = re.sub(r'[\s\-\(\)\+\.]', '', phone_number)
    # Check if it contains only digits and has reasonable length
    if not re.match(r'^\d{7,20}$', cleaned):
        return False
    return True

def normalize_credit_card(card_number):
    """Normalize credit card number by removing formatting."""
    return re.sub(r'[\s-]', '', card_number)

def normalize_phone(phone_number):
    """Normalize phone number by removing formatting."""
    return re.sub(r'[\s\-\(\)\+\.]', '', phone_number)

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Create a new association of a credit card number with a phone number."""
    try:
        # Parse JSON request
        if not request.is_json:
            return jsonify({'error': 'Invalid request format'}), 400
        
        data = request.get_json(force=True, silent=True)
        
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'Invalid request format'}), 400
        
        credit_card = data.get('credit_card', '')
        phone = data.get('phone', '')
        
        # Validate input
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid request'}), 400
        
        # Normalize the data
        credit_card = normalize_credit_card(credit_card)
        phone = normalize_phone(phone)
        
        # Store in database
        try:
            with closing(sqlite3.connect(DATABASE)) as db:
                db.execute(
                    'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                    (credit_card, phone)
                )
                db.commit()
        except sqlite3.IntegrityError:
            # Association already exists - still return 201 as requested
            pass
        except sqlite3.Error:
            return jsonify({'error': 'Invalid request'}), 400
        
        return jsonify({'message': 'Association created successfully'}), 201
        
    except (ValueError, TypeError, KeyError):
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        # Generic error message to avoid information leakage
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with a set of phone numbers."""
    try:
        # Parse JSON request
        if not request.is_json:
            return jsonify({'error': 'Invalid request format'}), 400
        
        data = request.get_json(force=True, silent=True)
        
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'Invalid request format'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not phone_numbers or not isinstance(phone_numbers, list) or len(phone_numbers) == 0:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate and normalize phone numbers
        normalized_phones = []
        for phone in phone_numbers:
            if not validate_phone(phone):
                return jsonify({'error': 'Invalid request'}), 400
            normalized_phones.append(normalize_phone(phone))
        
        # Remove duplicates
        normalized_phones = list(set(normalized_phones))
        
        if not normalized_phones:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Query database for cards associated with ALL given phone numbers
        try:
            with closing(sqlite3.connect(DATABASE)) as db:
                # Build query to find cards associated with all phones
                placeholders = ','.join('?' * len(normalized_phones))
                query = f'''
                    SELECT credit_card 
                    FROM card_phone_associations 
                    WHERE phone IN ({placeholders})
                    GROUP BY credit_card
                    HAVING COUNT(DISTINCT phone) = ?
                '''
                
                cursor = db.execute(query, normalized_phones + [len(normalized_phones)])
                cards = [row[0] for row in cursor.fetchall()]
        except sqlite3.Error:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not cards:
            return jsonify({'error': 'Not found'}), 404
        
        return jsonify({'card_numbers': cards}), 200
        
    except (ValueError, TypeError, KeyError):
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        # Generic error message to avoid information leakage
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)