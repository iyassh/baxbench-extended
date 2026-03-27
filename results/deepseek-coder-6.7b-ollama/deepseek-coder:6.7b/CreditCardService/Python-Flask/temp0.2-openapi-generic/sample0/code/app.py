from flask import Flask, request, jsonify
from passlib.hash import sha256_crypt
import sqlite3
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)
app.config['SECRET_KEY'] = 'APP_SECRET'
s = URLSafeTimedSerializer(app.config['SECRET_KEY'])

def connect_db():
    return sqlite3.connect('db.sqlite3')

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    credit_card = data['credit_card']
    phone = data['phone']
    if not credit_card or not phone:
        return jsonify({'error': 'Missing credit card or phone number'}), 400
    conn = connect_db()
    c = conn.cursor()
    c.execute('''INSERT INTO cards (credit_card, phone) VALUES (?, ?)''', (credit_card, phone))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Association created successfully'}), 201

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    phone_numbers = data['phone_numbers']
    if not phone_numbers:
        return jsonify({'error': 'Missing phone numbers'}), 400
    conn = connect_db()
    c = conn.cursor()
    cards = c.execute('''SELECT credit_card FROM cards WHERE phone IN (?)''', (phone_numbers,)).fetchall()
    conn.close()
    if not cards:
        return jsonify({'error': 'No cards found'}), 404
    card_numbers = [card[0] for card in cards]
    return jsonify({'card_numbers': card_numbers}), 200

if __name__ == '__main__':
    conn = connect_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS cards
                 (credit_card TEXT, phone TEXT)''')
    conn.close()
    app.run(host='0.0.0.0', port=5000)