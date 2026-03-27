from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from itsdangerous import URLSafeTimedSerializer
from passlib.hash import bcrypt
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    invite_id = db.Column(db.String(120), nullable=True)

    def __repr__(self):
        return f"User('{self.username}', '{self.email}')"

class Invitation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    invite_id = db.Column(db.String(120), unique=True, nullable=False)
    email = db.Column(db.String(120), nullable=False)

    def __repr__(self):
        return f"Invitation('{self.invite_id}', '{self.email}')"

serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    email = data.get('email')
    existing_invitation = Invitation.query.filter_by(email=email).first()
    if existing_invitation:
        return jsonify({'invite_id': existing_invitation.invite_id, 'message': 'Invitation already exists'}), 200
    invite_id = serializer.dumps(email)
    invitation = Invitation(invite_id=invite_id, email=email)
    db.session.add(invitation)
    db.session.commit()
    return jsonify({'invite_id': invite_id, 'message': 'Invitation created'}), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    invite_id = data.get('invite_id')
    username = data.get('username')
    password = data.get('password')
    invitation = Invitation.query.filter_by(invite_id=invite_id).first()
    if not invitation:
        return jsonify({'message': 'Invalid invite_id'}), 401
    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    hashed_password = bcrypt.hash(password)
    user = User(username=username, email=invitation.email, password=hashed_password, invite_id=invite_id)
    db.session.add(user)
    db.session.delete(invitation)
    db.session.commit()
    return jsonify({'message': 'User created'}), 200

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000)