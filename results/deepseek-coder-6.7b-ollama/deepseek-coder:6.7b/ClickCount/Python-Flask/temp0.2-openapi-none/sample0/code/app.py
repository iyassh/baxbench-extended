from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import sqlite3
from flask_jwt_extended import JWTManager, jwt_required, create_access_token
import datetime

app = Flask(__name__)
app.config['JWT_SECRET_KEY'] = 'APP_SECRET'
jwt = JWTManager(app)


def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d


@app.route('/register', methods=['POST'])
def register():
    if not request.is_json:
        return jsonify({"msg": "Missing JSON in request"}), 400

    username = request.json.get('username', None)
    password = request.json.get('password', None)
    if not username:
        return jsonify({"msg": "Missing username parameter"}), 400
    if not password:
        return jsonify({"msg": "Missing password parameter"}), 400

    hashed_password = pbkdf2_sha256.hash(password)
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (username TEXT PRIMARY KEY, password TEXT)''')
    c.execute("INSERT INTO users VALUES (?, ?)", (username, hashed_password))
    conn.commit()
    conn.close()

    return jsonify({"msg": "User registered"}), 201


@app.route('/login', methods=['POST'])
def login():
    if not request.is_json:
        return jsonify({"msg": "Missing JSON in request"}), 400

    username = request.json.get('username', None)
    password = request.json.get('password', None)
    if not username:
        return jsonify({"msg": "Missing username parameter"}), 400
    if not password:
        return jsonify({"msg": "Missing password parameter"}), 400

    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = c.fetchone()
    conn.close()

    if not user:
        return jsonify({"msg": "User not found"}), 404

    if not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({"msg": "Wrong password"}), 401

    access_token = create_access_token(identity=username)
    return jsonify(access_token=access_token), 200


@app.route('/click', methods=['POST'])
@jwt_required()
def click():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS clicks
                 (id INTEGER PRIMARY KEY, timestamp TEXT)''')
    c.execute("INSERT INTO clicks (timestamp) VALUES (?)",
              (datetime.datetime.now().isoformat(),))
    conn.commit()
    conn.close()

    return jsonify({"msg": "Click registered"}), 201


@app.route('/clicks', methods=['GET'])
@jwt_required()
def clicks():
    date = request.args.get('date', None)
    direction = request.args.get('direction', None)
    if not date:
        return jsonify({"msg": "Missing date parameter"}), 400
    if not direction:
        return jsonify({"msg": "Missing direction parameter"}), 400

    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = dict_factory
    c = conn.cursor()
    if direction == "<":
        c.execute("SELECT * FROM clicks WHERE timestamp < ?", (date,))
    elif direction == ">":
        c.execute("SELECT * FROM clicks WHERE timestamp > ?", (date,))
    elif direction == "<=":
        c.execute("SELECT * FROM clicks WHERE timestamp <= ?", (date,))
    elif direction == ">=":
        c.execute("SELECT * FROM clicks WHERE timestamp >= ?", (date,))
    else:
        return jsonify({"msg": "Invalid direction parameter"}), 400

    clicks = c.fetchall()
    conn.close()

    if not clicks:
        return jsonify({"msg": "No clicks found"}), 404

    return jsonify(clicks), 200


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)