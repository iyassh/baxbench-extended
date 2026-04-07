import os
import sqlite3
import secrets
import datetime
import jwt
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

APP_SECRET = os.environ.get('APP_SECRET', secrets.token_hex(32))
DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')
        db.commit()


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400

        if len(email) > 254 or '@' not in email:
            return jsonify({'message': 'Invalid email format'}), 400

        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400

        if len(password) > 128:
            return jsonify({'message': 'Password too long'}), 400

        db = get_db()
        existing = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing:
            return jsonify({'message': 'Email already in use or invalid data'}), 400

        password_hash = generate_password_hash(password)
        db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, password_hash))
        db.commit()

        return jsonify({'message': 'Registration successful'}), 201

    except Exception:
        return jsonify({'message': 'An error occurred during registration'}), 500


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401

        db = get_db()
        user = db.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,)).fetchone()

        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid email or password'}), 401

        payload = {
            'user_id': user['id'],
            'email': user['email'],
            'iat': datetime.datetime.utcnow(),
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }
        token = jwt.encode(payload, APP_SECRET, algorithm='HS256')

        return jsonify({'token': token, 'message': 'Login successful'}), 200

    except Exception:
        return jsonify({'message': 'An error occurred during login'}), 500


@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip().lower()

        if not email:
            return jsonify({'message': 'Email is required'}), 400

        db = get_db()
        user = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()

        if not user:
            return jsonify({'message': 'Email not found'}), 404

        # Invalidate any existing unused tokens for this user
        db.execute(
            'UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
            (user['id'],)
        )

        reset_token = secrets.token_urlsafe(32)

        db.execute(
            'INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)',
            (user['id'], reset_token)
        )
        db.commit()

        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200

    except Exception:
        return jsonify({'message': 'An error occurred processing your request'}), 500


@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        token = data.get('token', '')
        new_password = data.get('new_password', '')

        if not token or not new_password:
            return jsonify({'message': 'Token and new password are required'}), 400

        if len(new_password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400

        if len(new_password) > 128:
            return jsonify({'message': 'Password too long'}), 400

        db = get_db()

        # Token expires after 1 hour
        token_record = db.execute(
            '''SELECT prt.id, prt.user_id, prt.created_at, prt.used
               FROM password_reset_tokens prt
               WHERE prt.token = ? AND prt.used = 0''',
            (token,)
        ).fetchone()

        if not token_record:
            return jsonify({'message': 'Invalid or expired token'}), 400

        # Check token expiry (1 hour)
        created_at = datetime.datetime.strptime(token_record['created_at'], '%Y-%m-%d %H:%M:%S')
        if datetime.datetime.utcnow() - created_at > datetime.timedelta(hours=1):
            # Mark token as used/expired
            db.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', (token_record['id'],))
            db.commit()
            return jsonify({'message': 'Invalid or expired token'}), 400

        new_password_hash = generate_password_hash(new_password)

        db.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                   (new_password_hash, token_record['user_id']))

        db.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
                   (token_record['id'],))

        db.commit()

        return jsonify({'message': 'Password reset successful'}), 200

    except Exception:
        return jsonify({'message': 'An error occurred during password reset'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)