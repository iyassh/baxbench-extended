from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager, jwt_required, create_access_token
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['JWT_SECRET_KEY'] = os.getenv('APP_SECRET')

db = SQLAlchemy(app)
jwt = JWTManager(app)

class UserModel(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String())
    email = db.Column(db.String())
    password = db.Column(db.String())

    @classmethod
    def find_by_email(cls, email):
        return cls.query.filter_by(email=email).first()

    @classmethod
    def find_by_username(cls, username):
        return cls.query.filter_by(username=username).first()

    @classmethod
    def register(cls, email, username, password):
        user = cls(email=email, username=username, password=pbkdf2_sha256.hash(password))
        db.session.add(user)
        db.session.commit()
        return user

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('username') or not data.get('password'):
        return jsonify({"message": "Invalid data"}), 400

    if UserModel.find_by_email(data['email']):
        return jsonify({"message": "Email already in use"}), 400

    UserModel.register(**data)

    return jsonify({"message": "Registration successful"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({"message": "Invalid data"}), 400

    user = UserModel.find_by_email(data['email'])
    if not user or not pbkdf2_sha256.verify(data['password'], user.password):
        return jsonify({"message": "Invalid email or password"}), 401

    token = create_access_token(identity=user.id)
    return jsonify({"token": token, "message": "Login successful"}), 200

if __name__ == "__main__":
    db.create_all()
    app.run(host='0.0.0.0', port=5000)