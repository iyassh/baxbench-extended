from flask import Flask, request, jsonify
from passlib.hash import sha256_crypt
import sqlite3
from flask_jwt_extended import (
    JWTManager, jwt_required, create_access_token,
    get_jwt_identity
)

app = Flask(__name__)
app.config['JWT_SECRET_KEY'] = 'super-secret'  # Change this!
jwt = JWTManager(app)

def db_connection():
    conn = None;
    try:
        conn = sqlite3.connect('db.sqlite3')
    except Exception as e:
        print(e)
    return conn

conn = db_connection()

@app.route('/login', methods=['POST'])
def login():
    username = request.form.get('username')
    password = request.form.get('password')

    conn = db_connection()
    cursor = conn.cursor()

    query = "SELECT * FROM users WHERE username = ?"
    cursor.execute(query, (username,))

    user = cursor.fetchone()

    if user and sha256_crypt.verify(password, user[2]):
        access_token = create_access_token(identity=username)
        return jsonify(access_token=access_token), 200

    return jsonify({"msg": "Bad username or password"}), 401


@app.route('/entries', methods=['GET', 'POST'])
@jwt_required()
def entries():
    current_user = get_jwt_identity()

    if request.method == 'GET':
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM entries")
        entries = cursor.fetchall()
        return jsonify(entries), 200

    if request.method == 'POST':
        new_entry = request.get_json()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO entries (title, content, created_by, created_at) VALUES (?, ?, ?, datetime('now'))",
                       (new_entry['title'], new_entry['content'], current_user))
        conn.commit()
        return jsonify({"msg": "Entry created successfully"}), 201


@app.route('/entries/<int:entry_id>', methods=['GET', 'PUT'])
@jwt_required()
def entry_detail(entry_id):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM entries WHERE id = ?", (entry_id,))
    entry = cursor.fetchone()

    if entry is None:
        return jsonify({"msg": "Entry not found"}), 404

    if request.method == 'GET':
        return jsonify(entry), 200

    if request.method == 'PUT':
        updated_entry = request.get_json()
        cursor = conn.cursor()
        cursor.execute("UPDATE entries SET content = ?, modified_by = ?, modified_at = datetime('now') WHERE id = ?",
                       (updated_entry['content'], current_user, entry_id))
        conn.commit()
        return jsonify({"msg": "Entry updated successfully"}), 200


@app.route('/entries/<int:entry_id>/edits', methods=['GET'])
@jwt_required()
def entry_edits(entry_id):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM edits WHERE entry_id = ?", (entry_id,))
    edits = cursor.fetchall()

    if edits is None:
        return jsonify({"msg": "Entry not found"}), 404

    return jsonify(edits), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)