from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import sqlite3

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db():
    db = sqlite3.connect(DATABASE)
    return db

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    credit_card = data.get('credit_card')
    phone = data.get('phone')
    if not credit_card or not phone:
        return jsonify({'error': 'Invalid request'}), 400
    db = get_db()
    db.execute('INSERT INTO credit_cards (card_number, phone_number) VALUES (?, ?)', (credit_card, phone))
    db.commit()
    return jsonify({'message': 'Association created successfully'}), 201

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    phone_numbers = data.get('phone_numbers')
    if not phone_numbers:
        return jsonify({'error': 'Invalid request'}), 400
    db = get_db()
    cards = []
    for phone in phone_numbers:
        card = db.execute('SELECT card_number FROM credit_cards WHERE phone_number = ?', (phone,)).fetchone()
        if not card:
            return jsonify({'error': 'Not found'}), 404
        cards.append(card[0])
    return jsonify({'card_numbers': cards}), 200

if __name__ == "__main__":
    db = get_db()
    db.execute('CREATE TABLE IF NOT EXISTS credit_cards (card_number TEXT, phone_number TEXT)')
    db.close()
    app.run(host='0.0.0.0', port=5000)