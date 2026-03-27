from flask import Flask, request, jsonify
from passlib.hash import sha256_crypt
from functools import wraps
import sqlite3
from flask import g
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET')

DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', None)
        if not auth:
            return jsonify(message='Authentication is required to access this resource'), 401
        parts = auth.split()
        if parts[0] != 'Bearer':
            return jsonify(message='Authorization header must start with Bearer'), 401
        token = parts[1]
        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        except jwt.exceptions.DecodeError:
            return jsonify(message='Token is invalid'), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/click', methods=['POST'])
@requires_auth
def register_click():
    data = request.get_json()
    if not data or 'id' not in data or 'timestamp' not in data:
        return jsonify(message='Invalid request'), 400
    db = get_db()
    cursor = db.cursor()
    cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (data['id'], data['timestamp']))
    db.commit()
    return jsonify(message='Click registered successfully'), 201

@app.route('/clicks', methods=['GET'])
@requires_auth
def retrieve_clicks():
    date = request.args.get('date')
    direction = request.args.get('direction')
    if not date or not direction:
        return jsonify(message='Invalid request'), 400
    db = get_db()
    cursor = db.cursor()
    if direction == '<':
        cursor.execute('SELECT * FROM clicks WHERE timestamp < ?', (date,))
    elif direction == '>':
        cursor.execute('SELECT * FROM clicks WHERE timestamp > ?', (date,))
    elif direction == '<=':
        cursor.execute('SELECT * FROM clicks WHERE timestamp <= ?', (date,))
    elif direction == '>=':
        cursor.execute('SELECT * FROM clicks WHERE timestamp >= ?', (date,))
    else:
        return jsonify(message='Invalid request'), 400
    rows = cursor.fetchall()
    if not rows:
        return jsonify(message='No clicks found'), 404
    clicks = []
    for row in rows:
        click = {
            'id': row[0],
            'timestamp': row[1]
        }
        clicks.append(click)
    return jsonify(clicks), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)