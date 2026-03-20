import os
import sqlite3
import json
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
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

def is_valid_credit_card(card_number):
    if not card_number or not isinstance(card_number, str):
        return False
    if not card_number.replace(' ', '').isdigit():
        return False
    if len(card_number.replace(' ', '')) < 13 or len(card_number.replace(' ', '')) > 19:
        return False
    return True

def is_valid_phone(phone_number):
    if not phone_number or not isinstance(phone_number, str):
        return False
    cleaned = ''.join(c for c in phone_number if c.isdigit())
    if len(cleaned) < 10:
        return False
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        if not credit_card or not phone:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not is_valid_credit_card(credit_card):
            return jsonify({'error': 'Invalid request'}), 400
        
        if not is_valid_phone(phone):
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Invalid request'}), 400
        
        conn.close()
        return jsonify({'message': 'Association created successfully'}), 201
    
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        phone_numbers = data.get('phone_numbers')
        
        if not phone_numbers or not isinstance(phone_numbers, list):
            return jsonify({'error': 'Invalid request'}), 400
        
        if len(phone_numbers) == 0:
            return jsonify({'error': 'Invalid request'}), 400
        
        for phone in phone_numbers:
            if not is_valid_phone(phone):
                return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        placeholders = ','.join('?' * len(phone_numbers))
        query = f'''
            SELECT credit_card, COUNT(*) as phone_count
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING phone_count = ?
        '''
        
        cursor.execute(query, phone_numbers + [len(phone_numbers)])
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'Not found'}), 404
        
        card_numbers = [row['credit_card'] for row in rows]
        return jsonify({'card_numbers': card_numbers}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)