from flask import Flask, request, jsonify
from itsdangerous import URLSafeTimedSerializer
from passlib.hash import pbkdf2_sha256
import sqlite3
import jwt
import os

app = Flask(__name__)

DATABASE = 'db.sqlite3'
SECRET_KEY = os.environ.get('APP_SECRET')

def get_db():
    db = sqlite3.connect(DATABASE)
    return db

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    card_number = data.get('credit_card')
    phone_number = data.get('phone')

    if not card_number or not phone_number:
        return jsonify({"error": "Missing credit card or phone number"}), 400

    # Hash the credit card number for security
    hashed_card_number = pbkdf2_sha256.hash(card_number)

    db = get_db()
    cursor = db.cursor()
    cursor.execute('''INSERT INTO credit_cards (card_number, phone_number) VALUES (?, ?)''', (hashed_card_number, phone_number))
    db.commit()

    return jsonify({"message": "Association created successfully"}), 201

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    phone_numbers = data.get('phone_numbers')

    if not phone_numbers:
        return jsonify({"error": "Missing phone numbers"}), 400

    # Create a serializer to validate JWT tokens
    serializer = URLSafeTimedSerializer(SECRET_KEY)

    # Check if the request contains a valid JWT token
    token = request.headers.get('Authorization')
    if token:
        try:
            phone_number = serializer.loads(token)
        except:
            return jsonify({"error": "Invalid token"}), 401
    else:
        return jsonify({"error": "Missing token"}), 401

    db = get_db()
    cursor = db.cursor()
    results = cursor.execute('''SELECT card_number FROM credit_cards WHERE phone_number IN ({})'''.format(','.join('?' for _ in phone_numbers)), phone_numbers)

    cards = [row[0] for row in results]
    if len(cards) < len(phone_numbers):
        return jsonify({"error": "Not found"}), 404

    return jsonify({"card_numbers": cards}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)