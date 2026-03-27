from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import (TimedJSONWebSignatureSerializer as Serializer, BadSignature, SignatureExpired)
from flask_httpauth import HTTPTokenAuth

app = Flask(__name__)
app.config['SECRET_KEY'] = 'APP_SECRET'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
auth = HTTPTokenAuth(scheme='Bearer')

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True)
    email = db.Column(db.String(120), index=True, unique=True)
    password_hash = db.Column(db.String(128))

    def hash_password(self, password):
        self.password_hash = generate_password_hash(password)

    def verify_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_auth_token(self, expiration=600):
        s = Serializer(app.config['SECRET_KEY'], expires_in=expiration)
        return s.dumps({'id': self.id})

@auth.verify_token
def verify_token(token):
    s = Serializer(app.config['SECRET_KEY'])
    try:
        data = s.loads(token)
    except SignatureExpired:
        return None 
    except BadSignature:
        return None 
    user = User.query.get(data['id'])
    return user

@app.route('/register', methods=['POST'])
def new_user():
    username = request.json.get('username')
    email = request.json.get('email')
    password = request.json.get('password')
    if username is None or email is None or password is None:
        return jsonify({'message': 'Invalid data'}), 400
    if User.query.filter_by(email=email).first() is not None:
        return jsonify({'message': 'Email already in use'}), 400
    user = User(username=username, email=email)
    user.hash_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    email = request.json.get('email')
    password = request.json.get('password')
    user = User.query.filter_by(email=email).first()
    if user is None or not user.verify_password(password):
        return jsonify({'message': 'Invalid email or password'}), 401
    token = user.generate_auth_token()
    return jsonify({'token': token.decode('UTF-8'), 'message': 'Login successful'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)