from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
import datetime
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = 'APP_SECRET'
db = SQLAlchemy(app)

class UserModel(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    username = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)

    def save_to_db(self):
        db.session.add(self)
        db.session.commit()

    @classmethod
    def find_by_email(cls, email):
        return cls.query.filter_by(email=email).first()

    @classmethod
    def find_by_username(cls, username):
        return cls.query.filter_by(username=username).first()


class SecretModel(db.Model):
    __tablename__ = 'secrets'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(120), nullable=False)
    secret = db.Column(db.String(120), nullable=False)

    def save_to_db(self):
        db.session.add(self)
        db.session.commit()

    @classmethod
    def find_by_username(cls, username):
        return cls.query.filter_by(username=username).first()


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if UserModel.find_by_email(data['email']):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    new_user = UserModel(
        email=data['email'],
        username=data['username'],
        password=pbkdf2_sha256.hash(data['password'])
    )
    new_user.save_to_db()
    return jsonify({'message': 'Registration successful'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = UserModel.find_by_email(data['email'])
    if user and pbkdf2_sha256.verify(data['password'], user.password):
        token = jwt.encode(
            {
                'user_id': user.id,
                'exp': datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
            },
            app.config['SECRET_KEY']
        )
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    return jsonify({'message': 'Invalid email or password'}), 401


@app.route('/set_secret', methods=['POST'])
def set_secret():
    token = request.headers.get('Authorization').split(" ")[1]
    data = request.get_json()
    try:
        decoded_token = jwt.decode(token, app.config['SECRET_KEY'])
        user = UserModel.find_by_username(data['username'])
        if user and user.id == decoded_token['user_id']:
            secret = SecretModel(username=data['username'], secret=data['secret'])
            secret.save_to_db()
            return jsonify({'message': 'Secret has been set successfully'}), 200
    except:
        pass
    return jsonify({'message': 'Invalid authentication token'}), 401


@app.route('/get_secret', methods=['GET'])
def get_secret():
    username = request.args.get('username')
    token = request.headers.get('Authorization').split(" ")[1]
    try:
        decoded_token = jwt.decode(token, app.config['SECRET_KEY'])
        user = UserModel.find_by_username(username)
        if user and user.id == decoded<｜begin▁of▁sentence｜>:
            secret = SecretModel.find_by_username(username)
            if secret:
                return jsonify({'secret': secret.secret}), 200
    except:
        pass
    return jsonify({'message': 'Invalid authentication token'}), 401


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)