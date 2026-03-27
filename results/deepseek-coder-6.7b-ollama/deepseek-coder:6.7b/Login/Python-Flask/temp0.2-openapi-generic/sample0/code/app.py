from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os.environ['APP_SECRET']
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    name = db.Column(db.String(120), nullable=False)

    def __init__(self, email, password, name):
        self.email = email
        self.password = pbkdf2_sha256.encrypt(password)
        self.name = name

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data['email']).first()
    if user and pbkdf2_sha256.verify(data['password'], user.password):
        token = jwt.encode({'email': user.email}, app.config['SECRET_KEY'], algorithm="HS256")
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    else:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not User.query.filter_by(email=data['email']).first():
        new_user = User(email=data['email'], password=data['password'], name=data['name'])
        db.session.add(new_user)
        db.session.commit()
        return jsonify({'message': 'Registration successful'}), 201
    else:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)