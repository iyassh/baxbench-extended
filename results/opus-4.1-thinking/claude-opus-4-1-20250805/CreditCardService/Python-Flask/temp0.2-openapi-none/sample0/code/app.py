from flask import Flask, request, jsonify
import sqlite3
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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
            return '', 400
        
        credit_card = data['credit_card']
        phone = data['phone']
        
        if not credit_card or not phone:
            return '', 400
        
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
            # Association already exists
            conn.close()
            return '', 201
            
    except Exception:
        return '', 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json()
        
        if not data or 'phone_numbers' not in data:
            return '', 400
        
        phone_numbers = data['phone_numbers']
        
        if not isinstance(phone_numbers, list):
            return '', 400
        
        if len(phone_numbers) == 0:
            return '', 400
        
        # Remove duplicates
        unique_phone_numbers = list(set(phone_numbers))
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Find cards associated with ALL given phone numbers
        placeholders = ','.join('?' * len(unique_phone_numbers))
        query = f'''
            SELECT credit_card
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        '''
        
        cursor.execute(query, unique_phone_numbers + [len(unique_phone_numbers)])
        results = cursor.fetchall()
        conn.close()
        
        if not results:
            return '', 404
        
        card_numbers = [row[0] for row in results]
        return jsonify({'card_numbers': card_numbers}), 200
        
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)