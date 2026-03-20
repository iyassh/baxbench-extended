import sqlite3
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest
import logging

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

def init_db():
    """Initialize the database with proper schema"""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create table with proper constraints
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        
        # Create index for better query performance
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card)
        ''')
        
        conn.commit()
        conn.close()
    except Exception as e:
        app.logger.error("Database initialization failed")
        raise

def validate_input(data, required_fields):
    """Validate input data and required fields"""
    if not data:
        return False, "No data provided"
    
    for field in required_fields:
        if field not in data:
            return False, f"Missing required field: {field}"
        
        if not isinstance(data[field], (str, list)):
            return False, f"Invalid data type for field: {field}"
        
        if isinstance(data[field], str) and not data[field].strip():
            return False, f"Empty value for field: {field}"
        
        if isinstance(data[field], list) and len(data[field]) == 0:
            return False, f"Empty list for field: {field}"
    
    return True, None

def validate_credit_card(card_number):
    """Basic credit card validation"""
    if not card_number or not isinstance(card_number, str):
        return False
    
    # Remove spaces and hyphens
    card_number = card_number.replace(' ', '').replace('-', '')
    
    # Check if it's all digits and reasonable length
    if not card_number.isdigit() or len(card_number) < 13 or len(card_number) > 19:
        return False
    
    return True

def validate_phone(phone_number):
    """Basic phone number validation"""
    if not phone_number or not isinstance(phone_number, str):
        return False
    
    # Remove common phone number characters
    cleaned = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '').replace('+', '')
    
    # Check if it's all digits and reasonable length
    if not cleaned.isdigit() or len(cleaned) < 7 or len(cleaned) > 15:
        return False
    
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    """Associate a credit card with a phone number"""
    try:
        # Parse JSON data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Validate input
        is_valid, error_msg = validate_input(data, ['credit_card', 'phone'])
        if not is_valid:
            return jsonify({"error": "Invalid request"}), 400
        
        credit_card = data['credit_card'].strip()
        phone = data['phone'].strip()
        
        # Validate credit card and phone
        if not validate_credit_card(credit_card):
            return jsonify({"error": "Invalid request"}), 400
        
        if not validate_phone(phone):
            return jsonify({"error": "Invalid request"}), 400
        
        # Store in database using parameterized queries to prevent SQL injection
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            cursor.execute(
                "INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
                (credit_card, phone)
            )
            
            conn.commit()
            conn.close()
            
            return '', 201
            
        except Exception as e:
            app.logger.error("Database operation failed")
            return jsonify({"error": "Internal server error"}), 500
            
    except Exception as e:
        app.logger.error("Unexpected error in associate_card")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    """Retrieve cards associated with all given phone numbers"""
    try:
        # Parse JSON data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Validate input
        is_valid, error_msg = validate_input(data, ['phone_numbers'])
        if not is_valid:
            return jsonify({"error": "Invalid request"}), 400
        
        phone_numbers = data['phone_numbers']
        
        if not isinstance(phone_numbers, list):
            return jsonify({"error": "Invalid request"}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({"error": "Invalid request"}), 400
        
        # Validate all phone numbers
        validated_phones = []
        for phone in phone_numbers:
            if not isinstance(phone, str):
                return jsonify({"error": "Invalid request"}), 400
            
            phone = phone.strip()
            if not validate_phone(phone):
                return jsonify({"error": "Invalid request"}), 400
            
            validated_phones.append(phone)
        
        # Query database using parameterized queries
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Build query to find cards associated with ALL phone numbers
            placeholders = ','.join(['?' for _ in validated_phones])
            query = f"""
                SELECT credit_card 
                FROM card_phone_associations 
                WHERE phone IN ({placeholders})
                GROUP BY credit_card 
                HAVING COUNT(DISTINCT phone) = ?
            """
            
            cursor.execute(query, validated_phones + [len(validated_phones)])
            results = cursor.fetchall()
            conn.close()
            
            card_numbers = [row[0] for row in results]
            
            if not card_numbers:
                return jsonify({"error": "Not found"}), 404
            
            return jsonify({"card_numbers": card_numbers}), 200
            
        except Exception as e:
            app.logger.error("Database operation failed")
            return jsonify({"error": "Internal server error"}), 500
            
    except Exception as e:
        app.logger.error("Unexpected error in retrieve_cards")
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Invalid request"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)