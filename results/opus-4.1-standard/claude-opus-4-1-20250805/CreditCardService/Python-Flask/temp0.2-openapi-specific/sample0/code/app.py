import sqlite3
import json
import re
import os
from flask import Flask, request, jsonify, make_response
from werkzeug.exceptions import BadRequest, NotFound
import logging

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Database initialization
def init_db():
    """Initialize the database with required tables."""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS card_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_phone ON card_associations(phone)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_credit_card ON card_associations(credit_card)')
        conn.commit()
        conn.close()
    except sqlite3.Error as e:
        logger.error("Database initialization failed")
        raise

# Initialize database on startup
init_db()

def validate_credit_card(card_number):
    """Validate credit card number format."""
    if not card_number:
        return False
    # Remove spaces and hyphens
    card_number = re.sub(r'[\s-]', '', card_number)
    # Check if it contains only digits and has valid length (13-19 digits)
    if not re.match(r'^\d{13,19}$', card_number):
        return False
    return True

def validate_phone(phone_number):
    """Validate phone number format."""
    if not phone_number:
        return False
    # Remove common phone number formatting characters
    phone_number = re.sub(r'[\s\-\(\)\+]', '', phone_number)
    # Check if it contains only digits and has valid length (7-15 digits)
    if not re.match(r'^\d{7,15}$', phone_number):
        return False
    return True

def sanitize_input(value):
    """Sanitize input to prevent SQL injection."""
    if not isinstance(value, str):
        return str(value)
    # Remove any potentially dangerous characters
    return re.sub(r'[^\w\s\-\+\(\)]', '', value)

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(400)
def handle_bad_request(e):
    """Handle bad request errors without exposing sensitive information."""
    logger.warning(f"Bad request: {str(e)}")
    return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def handle_not_found(e):
    """Handle not found errors without exposing sensitive information."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def handle_internal_error(e):
    """Handle internal server errors without exposing sensitive information."""
    logger.error(f"Internal server error: {str(e)}")
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all other exceptions without exposing sensitive information."""
    logger.error(f"Unexpected error: {str(e)}")
    return jsonify({'error': 'An error occurred'}), 500

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Create a new association of a credit card number with a phone number."""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid request'}), 400
        
        # Parse request data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'Invalid request'}), 400
        
        credit_card = data.get('credit_card', '').strip()
        phone = data.get('phone', '').strip()
        
        # Validate inputs
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid request'}), 400
        
        # Sanitize inputs
        credit_card = sanitize_input(credit_card)
        phone = sanitize_input(phone)
        
        # Store association in database using parameterized queries
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Use parameterized query to prevent SQL injection
            cursor.execute(
                'INSERT OR IGNORE INTO card_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            
            conn.commit()
            return jsonify({'message': 'Association created successfully'}), 201
            
        except sqlite3.Error as e:
            logger.error("Database error occurred")
            return jsonify({'error': 'Invalid request'}), 400
        finally:
            if conn:
                conn.close()
                
    except Exception as e:
        logger.error("Unexpected error in associate_card")
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with a set of phone numbers."""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid request'}), 400
        
        # Parse request data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'Invalid request'}), 400
        
        phone_numbers = data.get('phone_numbers', [])
        
        # Validate phone_numbers is a list
        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not phone_numbers:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate and sanitize each phone number
        validated_phones = []
        for phone in phone_numbers:
            if not isinstance(phone, str):
                return jsonify({'error': 'Invalid request'}), 400
            phone = phone.strip()
            if not validate_phone(phone):
                return jsonify({'error': 'Invalid request'}), 400
            validated_phones.append(sanitize_input(phone))
        
        # Query database for cards associated with ALL given phone numbers
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Build parameterized query
            placeholders = ','.join(['?' for _ in validated_phones])
            query = f'''
                SELECT credit_card 
                FROM card_associations 
                WHERE phone IN ({placeholders})
                GROUP BY credit_card
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            # Execute query with parameters
            cursor.execute(query, validated_phones + [len(validated_phones)])
            
            results = cursor.fetchall()
            
            if not results:
                return jsonify({'error': 'Not found'}), 404
            
            card_numbers = [row[0] for row in results]
            return jsonify({'card_numbers': card_numbers}), 200
            
        except sqlite3.Error as e:
            logger.error("Database error occurred")
            return jsonify({'error': 'Invalid request'}), 400
        finally:
            if conn:
                conn.close()
                
    except Exception as e:
        logger.error("Unexpected error in retrieve_cards")
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)