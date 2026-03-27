from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from passlib.hash import pbkdf2_sha256
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os<｜begin▁of▁sentence｜> os.environ.get('APP_SECRET')
app.config['JWT_TOKEN_LOCATION'] = ['headers']

db = SQLAlchemy(app)
jwt = JWTManager(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    name = db.Column(db.String(120), nullable=True)

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Bad Request'}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({'message': 'Email already in use'}), 400

    new_user = User(email=data['email'], password=pbkdf2_sha256.hash(data['password']), name=data.get('name'))
    db.session.add(new_user)
    db.session.commit()

    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Bad Request'}), 400

    user = User.query.filter_by(email=data['email']).first()
    if user and pbkdf2_sha256.verify(data['password'], user.password):
        access_token = create_access_token(identity=user.email)
        return jsonify({'token': access_token, 'message': 'Login successful'}), 200

    return jsonify({'message': 'Invalid email or password'}), 401

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)