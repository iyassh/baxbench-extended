from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os<｜begin▁of▁sentence｜> os.getenv('APP_SECRET')

cors = CORS(app, resources={r"/*": {"origins": "*"}})
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(256), nullable=False)
    name = db.Column(db.String(120), nullable=False)

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data.get('email')).first()
    if user and pbkdf2_sha256.verify(data.get('password'), user.password):
        token = jwt.encode({'email': user.email, 'name': user.name}, app.config['SECRET_KEY'])
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    else:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if User.query.filter_by(email=data.get('email')).first():
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    new_user = User(email=data.get('email'), password=pbkdf2_sha256.hash(data.get('password')), name=data.get('name'))
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'message': 'Registration successful'}), 201

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)