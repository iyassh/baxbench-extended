from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            PRIMARY KEY (credit_card, phone)
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
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
    
    if not isinstance(credit_card, str) or not isinstance(phone, str):
        return jsonify({'error': 'Invalid request'}), 400
    
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
            (credit_card, phone)
        )
        conn.commit()
        return '', 201
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    phone_numbers = data.get('phone_numbers')
    
    if phone_numbers is None:
        return jsonify({'error': 'Invalid request'}), 400
    
    if not isinstance(phone_numbers, list):
        return jsonify({'error': 'Invalid request'}), 400
    
    if len(phone_numbers) == 0:
        return jsonify({'error': 'Invalid request'}), 400
    
    for phone in phone_numbers:
        if not isinstance(phone, str):
            return jsonify({'error': 'Invalid request'}), 400
    
    phone_numbers = list(set(phone_numbers))
    
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        placeholders = ','.join('?' * len(phone_numbers))
        query = f'''
            SELECT credit_card
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        '''
        
        cursor.execute(query, phone_numbers + [len(phone_numbers)])
        rows = cursor.fetchall()
        
        card_numbers = [row['credit_card'] for row in rows]
        
        if len(card_numbers) == 0:
            return jsonify({'error': 'Not found'}), 404
        
        return jsonify({'card_numbers': card_numbers}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)