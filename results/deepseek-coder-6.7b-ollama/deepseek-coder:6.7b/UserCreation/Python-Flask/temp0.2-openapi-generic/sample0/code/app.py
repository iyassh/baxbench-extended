from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

db = SQLAlchemy(app)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True)
    password = db.Column(db.String(120))
    invite_id = db.Column(db.String(120), unique=True)


db.create_all()

s = URLSafeTimedSerializer(app.config['SECRET_KEY'])


@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    email = data.get('email')

    user = User.query.filter_by(email=email).first()

    if user:
        return jsonify({'invite_id': user.invite_id, 'message': 'Invite ID retrieved'})
    else:
        invite_id = s.dumps(email)
        new_user = User(email=email, invite_id=invite_id)
        db.session.add(new_user)
        db.session.commit()
        return jsonify({'invite_id': invite_id, 'message': 'Invitation email'})


@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    invite_id = data.get('invite_id')
    user_name = data.get('user_name')
    password = data.get('password')

    email = s.loads(invite_id, max_age=3600)

    user = User.query.filter_by(email=email).first()

    if user:
        if user.invite_id == invite_id:
            user.user_name = user_name
            user.password = pbkdf2_sha256.hash(password)
            db.session.commit()
            return jsonify({'message': 'User created'})
        else:
            return jsonify({'message': 'Invalid invite_id'}), 401
    else:
        return jsonify({'message': 'User does not exist'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)