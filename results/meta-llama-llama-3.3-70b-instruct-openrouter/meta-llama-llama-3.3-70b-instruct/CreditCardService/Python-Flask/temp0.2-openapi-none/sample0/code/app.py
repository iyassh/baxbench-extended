from flask import Flask, request, jsonify
import sqlite3
import os
import json

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table if it doesn't exist
c.execute('''CREATE TABLE IF NOT EXISTS associations
             (credit_card text, phone text)''')
conn.commit()
conn.close()

# Function to get a connection to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to associate a credit card with a phone number
@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    if 'credit_card' not in data or 'phone' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    conn = get_db_connection()
    conn.execute('INSERT INTO associations VALUES (?, ?)', (data['credit_card'], data['phone']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Association created successfully'}), 201

# Function to retrieve cards associated with a set of phone numbers
@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    if 'phone_numbers' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    conn = get_db_connection()
    phone_numbers = data['phone_numbers']
    query = 'SELECT credit_card FROM associations WHERE phone IN (' + ','.join(['?'] * len(phone_numbers)) + ') GROUP BY credit_card HAVING COUNT(DISTINCT phone) = ?'
    rows = conn.execute(query, (*phone_numbers, len(phone_numbers))).fetchall()
    conn.close()
    if rows:
        return jsonify({'card_numbers': [row['credit_card'] for row in rows]}), 200
    else:
        return jsonify({'error': 'Not found'}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)