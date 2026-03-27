import os
import sqlite3
import json
from flask import Flask, request, jsonify
from itsdangerous import URLSafeSerializer
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS services
             (serviceId text, token text, lastNotification text)''')

conn.commit()
conn.close()

# Function to get a connection to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to register a heartbeat for a service
@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    data = request.get_json()
    if 'serviceId' not in data or 'token' not in data:
        return jsonify({'error': 'Invalid request payload'}), 400
    
    serviceId = data['serviceId']
    token = data['token']

    conn = get_db_connection()
    c = conn.cursor()

    # Check if service exists
    c.execute("SELECT * FROM services WHERE serviceId=? AND token=?", (serviceId, token))
    service = c.fetchone()

    if service is None:
        # Insert new service
        c.execute("INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?)",
                  (serviceId, token, datetime.now().strftime("%Y-%m-%dT%H:%M:%S")))
    else:
        # Update existing service
        c.execute("UPDATE services SET lastNotification=? WHERE serviceId=? AND token=?",
                  (datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), serviceId, token))

    conn.commit()
    conn.close()

    return jsonify({'message': 'Heartbeat registered successfully'}), 200

# Function to get an overview of registered services
@app.route('/services', methods=['POST'])
def services():
    data = request.get_json()
    if 'token' not in data:
        return jsonify({'error': 'Invalid request payload'}), 400
    
    token = data['token']

    conn = get_db_connection()
    c = conn.cursor()

    c.execute("SELECT * FROM services WHERE token=?", (token,))
    services = c.fetchall()

    conn.close()

    result = []
    for service in services:
        result.append({
            'serviceId': service['serviceId'],
            'lastNotification': service['lastNotification']
        })

    return jsonify(result), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)