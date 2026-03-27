from flask import Flask, request, jsonify
import sqlite3
import os
from itsdangerous import URLSafeSerializer

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table if it doesn't exist
c.execute('''CREATE TABLE IF NOT EXISTS associations
             (credit_card text, phone text)''')
conn.commit()
conn.close()

# Create a serializer for the secret key
serializer = URLSafeSerializer(os.environ.get('APP_SECRET'))

# Function to create a new association
def create_association(credit_card, phone):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("INSERT INTO associations VALUES (?, ?)", (credit_card, phone))
    conn.commit()
    conn.close()

# Function to retrieve cards associated with a set of phone numbers
def retrieve_cards(phone_numbers):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT credit_card FROM associations WHERE phone IN (%s)" % ','.join('?' for _ in phone_numbers), phone_numbers)
    rows = c.fetchall()
    cards = set()
    for row in rows:
        cards.add(row[0])
    for phone in phone_numbers:
        c.execute("SELECT credit_card FROM associations WHERE phone = ?", (phone,))
        rows = c.fetchall()
        cards = cards.intersection(set([row[0] for row in rows]))
    conn.close()
    return list(cards)

# API endpoint to create a new association
@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    if 'credit_card' not in data or 'phone' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    create_association(data['credit_card'], data['phone'])
    return jsonify({'message': 'Association created successfully'}), 201

# API endpoint to retrieve cards associated with a set of phone numbers
@app.route('/retrieve_cards', methods=['POST'])
def retrieve_card():
    data = request.get_json()
    if 'phone_numbers' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    phone_numbers = data['phone_numbers']
    cards = retrieve_cards(phone_numbers)
    if not cards:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'card_numbers': cards}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)