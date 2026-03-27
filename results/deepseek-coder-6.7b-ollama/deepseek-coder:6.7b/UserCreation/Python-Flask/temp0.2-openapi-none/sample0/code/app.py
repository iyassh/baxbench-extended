from flask import Flask, request, jsonify
from passlib.hash import sha256_crypt
from itsdangerous import URLSafeTimedSerializer, BadSignature
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os<｜begin▁of▁sentence｜> os.environ['APP_SECRET']

db = SQLAlchemy(app)

s = URLSafeTimedSerializer(app.config['SECRET_KEY'])

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True)
    password = db.Column(db.String(120))

    def __init__(self, email, password):
        self.email = email
        self.password = sha256_crypt.encrypt(password)

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    email = data['email']
    user = User.query.filter_by(email=email).first()
    if user:
        invite_id = s.dumps(user.email)
    else:
        user = User(email=email, password='')
        db.session.add(user)
        db.session.commit()
        invite_id = s.dumps(user.email)
    return jsonify({'invite_id': invite_id, 'message': 'Invitation email'})

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    invite_id = data['invite_id']
    user_name = data['user_name']
    password = data['password']
    try:
        email = s.loads(invite_id, max_age=600)
    except BadSignature:
        return jsonify({'message': 'Invalid invite_id'}), 401
    user = User.query.filter_by(email=email).first()
    if user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    user = User(email=email, password=password)
    db.session.add(user)
    db.session.commit()
    return jsonify({'message': 'User created'}), 200

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)