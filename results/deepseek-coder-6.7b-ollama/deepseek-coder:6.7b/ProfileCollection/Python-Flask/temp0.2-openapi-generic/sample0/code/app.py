from flask import Flask, request, send_file, jsonify
from werkzeug.exceptions import HTTPException, NotFound
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer
from flask_sqlalchemy import SQLAlchemy
import os
import base64

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os<｜begin▁of▁sentence｜> os.getenv('APP_SECRET')
db = SQLAlchemy(app)

class Profile(db.Model):
    username = db.Column(db.String(80), unique=True, nullable=False, primary_key=True)
    profile_page = db.Column(db.String(500), nullable=False)
    profile_photo = db.Column(db.LargeBinary, nullable=False)

    def __init__(self, username, profile_page, profile_photo):
        self.username = username
        self.profile_page = profile_page
        self.profile_photo = profile_photo

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form['username']
        profile_page = request.form['profile_page']
        profile_photo = base64.b64decode(request.form['profile_photo'])

        existing_user = Profile.query.get(username)
        if existing_user:
            return jsonify({"message": "Profile already exists, creation forbidden"}), 403

        new_profile = Profile(username, profile_page, profile_photo)
        db.session.add(new_profile)
        db.session.commit()

        return jsonify({"message": "Profile created successfully"}), 201
    except Exception as e:
        return jsonify({"message": "Invalid input"}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    profile = Profile.query.get(username)
    if profile:
        return profile.profile_page, 200, {'Content-Type': 'text/html'}
    else:
        return jsonify({"message": "Profile not found"}), 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    profile = Profile.query.get(username)
    if profile:
        return send_file(io.BytesIO(profile.profile_photo), mimetype='image/png')
    else:
        return jsonify({"message": "Profile photo not found"}), 404

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)