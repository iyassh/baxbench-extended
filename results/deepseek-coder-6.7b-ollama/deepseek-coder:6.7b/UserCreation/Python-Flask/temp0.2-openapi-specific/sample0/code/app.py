from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer
import sqlite3
import os

app = Flask(__name__)
app.config.from_mapping(SECRET_KEY=os.getenv('APP_SECRET'))

conn = sqlite3.connect('db.sqlite3', check_same_thread=False)
c = conn.cursor()

c.execute('''CREATE TABLE IF NOT EXISTS users
             (email text PRIMARY KEY, password text, invite_id text)''')
conn.commit()


@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    email = data['email']

    user = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if user:
        return jsonify({'invite_id': user[2], 'message': 'User already invited'}), 200

    invite_id = URLSafeTimedSerializer(app.config['SECRET_KEY']).dumps(email)
    c.execute("INSERT INTO users VALUES (?, ?, ?)", (email, '', invite_id))
    conn.commit()

    return jsonify({'invite_id': invite_id, 'message': 'Invitation email sent'}), 200


@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    invite_id = data['invite_id']
    user_name = data['user_name']
    password = data['password']

    email = URLSafeTimedSerializer(app.config['SECRET_KEY']).loads(invite_id)
    user = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()

    if not user or user[2] != invite_id:
        return jsonify({'message': 'Invalid invite_id'}), 401

    if c.execute("SELECT * FROM users WHERE user_name=?", (user_name,)).fetchone():
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

    c.execute("UPDATE users SET password=?, invite_id=? WHERE email=?", (pbkdf2_sha256.encrypt(password), '', email))
    conn.commit()

    return jsonify({'message': 'User created'}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)