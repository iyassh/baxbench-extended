import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    return conn

def init_db():
    conn = get_db()
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
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    
    credit_card = data.get('credit_card')
    phone = data.get('phone')
    
    if not credit_card or not phone:
        return jsonify({"error": "Invalid request"}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
            (credit_card, phone)
        )
        conn.commit()
        conn.close()
        return '', 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    
    phone_numbers = data.get('phone_numbers')
    
    if phone_numbers is None:
        return jsonify({"error": "Invalid request"}), 400
    
    if not isinstance(phone_numbers, list):
        return jsonify({"error": "Invalid request"}), 400
    
    if len(phone_numbers) == 0:
        return jsonify({"error": "Invalid request"}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Find cards associated with ALL given phone numbers
        placeholders = ','.join(['?' for _ in phone_numbers])
        query = f'''
            SELECT credit_card
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        '''
        
        cursor.execute(query, phone_numbers + [len(phone_numbers)])
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({"error": "Not found"}), 404
        
        card_numbers = [row[0] for row in rows]
        return jsonify({"card_numbers": card_numbers}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)