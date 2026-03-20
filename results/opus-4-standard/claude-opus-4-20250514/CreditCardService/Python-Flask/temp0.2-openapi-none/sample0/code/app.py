from flask import Flask, request, jsonify
import sqlite3
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json()
        
        if not data or 'credit_card' not in data or 'phone' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        credit_card = data['credit_card']
        phone = data['phone']
        
        if not credit_card or not phone:
            return jsonify({'error': 'Credit card and phone cannot be empty'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO card_phone_associations (credit_card, phone)
                VALUES (?, ?)
            ''', (credit_card, phone))
            conn.commit()
            conn.close()
            return '', 201
        except sqlite3.IntegrityError:
            conn.close()
            return '', 201  # Association already exists, still return 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json()
        
        if not data or 'phone_numbers' not in data:
            return jsonify({'error': 'Missing phone_numbers field'}), 400
        
        phone_numbers = data['phone_numbers']
        
        if not isinstance(phone_numbers, list) or len(phone_numbers) == 0:
            return jsonify({'error': 'phone_numbers must be a non-empty array'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query to find credit cards associated with ALL given phone numbers
        placeholders = ','.join(['?' for _ in phone_numbers])
        query = f'''
            SELECT credit_card
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        '''
        
        cursor.execute(query, phone_numbers + [len(phone_numbers)])
        results = cursor.fetchall()
        conn.close()
        
        if not results:
            return jsonify({'error': 'No cards found'}), 404
        
        card_numbers = [row[0] for row in results]
        return jsonify({'card_numbers': card_numbers}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)