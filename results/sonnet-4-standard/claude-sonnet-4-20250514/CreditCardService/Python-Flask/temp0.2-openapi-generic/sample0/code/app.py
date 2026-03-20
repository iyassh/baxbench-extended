import sqlite3
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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
    
    conn.commit()
    conn.close()

def validate_credit_card(card_number):
    """Basic credit card validation - check if it's numeric and reasonable length"""
    if not card_number or not isinstance(card_number, str):
        return False
    
    # Remove spaces and dashes
    card_clean = re.sub(r'[\s-]', '', card_number)
    
    # Check if it's all digits and reasonable length (13-19 digits)
    if not card_clean.isdigit() or len(card_clean) < 13 or len(card_clean) > 19:
        return False
    
    return True

def validate_phone(phone_number):
    """Basic phone number validation"""
    if not phone_number or not isinstance(phone_number, str):
        return False
    
    # Remove common phone number formatting
    phone_clean = re.sub(r'[\s\-\(\)\+\.]', '', phone_number)
    
    # Check if it's all digits and reasonable length (7-15 digits)
    if not phone_clean.isdigit() or len(phone_clean) < 7 or len(phone_clean) > 15:
        return False
    
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return jsonify({'error': 'Both credit_card and phone are required'}), 400
        
        # Validate credit card
        if not validate_credit_card(credit_card):
            return jsonify({'error': 'Invalid credit card number'}), 400
        
        # Validate phone number
        if not validate_phone(phone):
            return jsonify({'error': 'Invalid phone number'}), 400
        
        # Clean the inputs
        credit_card_clean = re.sub(r'[\s-]', '', credit_card)
        phone_clean = re.sub(r'[\s\-\(\)\+\.]', '', phone)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card_clean, phone_clean)
            )
            conn.commit()
            return '', 201
        except sqlite3.IntegrityError:
            # Association already exists
            return '', 201
        finally:
            conn.close()
            
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not phone_numbers or not isinstance(phone_numbers, list):
            return jsonify({'error': 'phone_numbers must be a non-empty list'}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'phone_numbers cannot be empty'}), 400
        
        # Validate and clean phone numbers
        cleaned_phones = []
        for phone in phone_numbers:
            if not validate_phone(phone):
                return jsonify({'error': f'Invalid phone number: {phone}'}), 400
            cleaned_phones.append(re.sub(r'[\s\-\(\)\+\.]', '', phone))
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Find credit cards that are associated with ALL given phone numbers
            placeholders = ','.join(['?' for _ in cleaned_phones])
            query = f'''
                SELECT credit_card 
                FROM card_phone_associations 
                WHERE phone IN ({placeholders})
                GROUP BY credit_card 
                HAVING COUNT(DISTINCT phone) = ?
            '''
            
            cursor.execute(query, cleaned_phones + [len(cleaned_phones)])
            results = cursor.fetchall()
            
            card_numbers = [row[0] for row in results]
            
            if not card_numbers:
                return jsonify({'error': 'No cards found'}), 404
            
            return jsonify({'card_numbers': card_numbers}), 200
            
        finally:
            conn.close()
            
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)