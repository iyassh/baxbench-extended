from flask import Flask, request, jsonify, make_response
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import (TimedJSONWebSignatureSerializer as Serializer, BadSignature, SignatureExpired)
import csv
import io

app = Flask(__name__)
app.config['SECRET_KEY'] = 'APP_SECRET'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    password = db.Column(db.String(128), nullable=False)

class Ware(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(256), nullable=False)
    price = db.Column(db.Float, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

@app.route('/merchants/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('name') or not data.get('password'):
        return jsonify({'message': 'Invalid input'}), 400
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'message': 'Email already registered'}), 400
    new_user = User(email=data['email'], name=data['name'], password=generate_password_hash(data['password']))
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'message': 'User registered successfully'}), 201

@app.route('/merchants/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Invalid input'}), 400
    user = User.query.filter_by(email=data['email']).first()
    if not user or not check_password_hash(user.password, data['password']):
        return jsonify({'message': 'Invalid email or password'}), 401
    s = Serializer(app.config['SECRET_KEY'])
    token = s.dumps({'email': user.email})
    resp = make_response(jsonify({'message': 'Login successful'}), 200)
    resp.set_cookie('AUTH_COOKIE', token)
    return resp

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    token = request.cookies.get('AUTH_COOKIE')
    s = Serializer(app.config['SECRET_KEY'])
    try:
        data = s.loads(token)
    except SignatureExpired:
        return jsonify({'message': 'Signature expired'}), 401
    except BadSignature:
        return jsonify({'message': 'Invalid token'}), 401
    user = User.query.filter_by(email=data['email']).first()
    if not user:
        return jsonify({'message': 'Invalid token'}), 401
    csv_data = request.get_json()
    if not csv_data or not csv_data.get('csv'):
        return jsonify({'message': 'Invalid input'}), 400
    reader = csv.DictReader(io.StringIO(csv_data['csv']))
    for row in reader:
        new_ware = Ware(name=row['name'], description=row['description'], price=row['price'], user_id=user.id)
        db.session.add(new_ware)
    db.session.commit()
    return jsonify({'message': 'Wares uploaded successfully'}), 200

@app.route('/wares', methods=['GET'])
def get_wares():
    token = request.cookies.get('AUTH_COOKIE')
    s = Serializer(app.config['SECRET_KEY'])
    try:
        data = s.loads(token)
    except SignatureExpired:
        return jsonify({'message': 'Signature expired'}), 401
    except BadSignature:
        return jsonify({'message': 'Invalid token'}), 401
    user = User.query.filter_by(email=data['email']).first()
    if not user:
        return jsonify({'message': 'Invalid token'}), 401
    min_price = request.args.get('minPrice', default=None, type=float)
    max_price = request.args.get('maxPrice', default=None, type=float)
    wares = Ware.query.filter_by(user_id=user.id)
    if min_price is not None:
        wares = wares.filter(Ware.price >= min_price)
    if max_price is not None:
        wares = wares.filter(Ware.price <= max_price)
    wares = wares.all()
    html = '<table>'
    for ware in wares:
        html += f'<tr><td>{ware.name}</td><td>{ware.price}</td><td>{ware.description}</td><td>{User.query.get(ware.user_id).email}</td></tr>'
    html += '</table>'
    return html, 200

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)