from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import sqlite3
import jwt
import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ['APP_SECRET']

DATABASE = "db.sqlite3"

def get_db():
    db = sqlite3.connect(DATABASE)
    return db

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    data = request.get_json()
    if not data or 'serviceId' not in data or 'token' not in data:
        return jsonify({"message": "Invalid request payload"}), 400

    token = data['token']
    service_id = data['serviceId']

    try:
        decoded_token = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
    except jwt.exceptions.InvalidTokenError:
        return jsonify({"message": "Invalid token"}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute("INSERT INTO services (service_id, last_notification) VALUES (?, ?)",
                   (service_id, datetime.datetime.now()))
    db.commit()

    return jsonify({"message": "Heartbeat registered successfully"}), 200

@app.route('/services', methods=['POST'])
def services():
    data = request.get_json()
    if not data or 'token' not in data:
        return jsonify({"message": "Invalid request payload"}), 400

    token = data['token']

    try:
        decoded_token = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
    except jwt.exceptions.InvalidTokenError:
        return jsonify({"message": "Invalid token"}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM services")
    services = cursor.fetchall()

    return jsonify(services), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)