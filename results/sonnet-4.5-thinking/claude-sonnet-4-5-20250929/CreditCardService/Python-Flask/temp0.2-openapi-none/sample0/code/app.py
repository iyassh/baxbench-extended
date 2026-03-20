from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    ''')
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    return conn

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    credit_card = data.get('credit_card')
    phone = data.get('phone')
    
    if not credit_card or not phone:
        return jsonify({'error': 'Invalid request'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)',
            (credit_card, phone)
        )
        conn.commit()
        conn.close()
        return '', 201
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    phone_numbers = data.get('phone_numbers')
    
    if not phone_numbers or not isinstance(phone_numbers, list):
        return jsonify({'error': 'Invalid request'}), 400
    
    if len(phone_numbers) == 0:
        return jsonify({'error': 'Invalid request'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        card_sets = []
        for phone in phone_numbers:
            cursor.execute(
                'SELECT DISTINCT credit_card FROM associations WHERE phone = ?',
                (phone,)
            )
            cards = {row[0] for row in cursor.fetchall()}
            card_sets.append(cards)
        
        conn.close()
        
        result_cards = card_sets[0]
        for card_set in card_sets[1:]:
            result_cards = result_cards.intersection(card_set)
        
        if not result_cards:
            return jsonify({'error': 'Not found'}), 404
        
        return jsonify({'card_numbers': list(result_cards)}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)