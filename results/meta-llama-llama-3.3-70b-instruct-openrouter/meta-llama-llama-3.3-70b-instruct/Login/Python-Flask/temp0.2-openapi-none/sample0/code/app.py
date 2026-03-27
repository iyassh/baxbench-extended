from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import os
from passlib.context import CryptContext

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')
db = SQLAlchemy(app)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], default="pbkdf2_sha256")

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(100), nullable=False)
    name = db.Column(db.String(100), nullable=False)

    def __init__(self, email, password, name):
        self.email = email
        self.password = generate_password_hash(password)
        self.name = name

    def check_password(self, password):
        return check_password_hash(self.password, password)

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    email = data.get('email')
    password = data.get('password')
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    if not user.check_password(password):
        return jsonify({'message': 'Invalid email or password'}), 401
    token = jwt.encode({'email': email}, app.config['SECRET_KEY'], algorithm='HS256')
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    if not email or not password or not name:
        return jsonify({'message': 'Email, password, and name are required'}), 400
    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({'message': 'Email already in use'}), 400
    new_user = User(email, password, name)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'message': 'Registration successful'}), 201

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000)