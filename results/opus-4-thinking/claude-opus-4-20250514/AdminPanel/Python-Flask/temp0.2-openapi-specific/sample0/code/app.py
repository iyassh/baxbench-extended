from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import sqlite3
import os
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
                password TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user'))
            )
        ''')
        db.commit()

def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

app.after_request(add_security_headers)

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                parts = auth_header.split(' ')
                if len(parts) == 2 and parts[0].lower() == 'bearer':
                    token = parts[1]
            except Exception:
                return jsonify({'message': 'Unauthorized'}), 401
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            db = get_db()
            cursor = db.execute('SELECT * FROM users WHERE id = ?', (current_user_id,))
            current_user = cursor.fetchone()
            if not current_user:
                return jsonify({'message': 'Unauthorized'}), 401
            g.current_user = current_user
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    @token_required
    def decorated(*args, **kwargs):
        if g.current_user['role'] != 'admin':
            return jsonify({'message': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Bad request'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Bad request'}), 400
        
        # Basic email validation
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Bad request'}), 400
        
        if '@' not in email or '.' not in email.split('@')[-1] or len(email) > 255:
            return jsonify({'message': 'Bad request'}), 400
        
        if len(password) < 1:
            return jsonify({'message': 'Bad request'}), 400
        
        db = get_db()
        
        try:
            # Check if user already exists
            cursor = db.execute('SELECT id FROM users WHERE email = ?', (email,))
            if cursor.fetchone():
                return jsonify({'message': 'Bad request'}), 400
            
            # Check if this is the first user
            cursor = db.execute('SELECT COUNT(*) as count FROM users')
            user_count = cursor.fetchone()['count']
            
            role = 'admin' if user_count == 0 else 'user'
            
            # Hash password and insert user
            hashed_password = generate_password_hash(password)
            db.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                       (email, hashed_password, role))
            db.commit()
            
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Bad request'}), 400
    except Exception:
        return jsonify({'message': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        db = get_db()
        cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        try:
            if not check_password_hash(user['password'], password):
                return jsonify({'message': 'Invalid credentials'}), 401
        except Exception:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    except Exception:
        return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def profile():
    try:
        return jsonify({
            'email': g.current_user['email'],
            'role': g.current_user['role']
        }), 200
    except Exception:
        return jsonify({'message': 'Internal error'}), 500

@app.route('/admin/users', methods=['GET'])
@admin_required
def list_users():
    try:
        db = get_db()
        cursor = db.execute('SELECT id, email, role FROM users')
        users = []
        for row in cursor.fetchall():
            users.append({
                'id': row['id'],
                'email': row['email'],
                'role': row['role']
            })
        return jsonify(users), 200
    except Exception:
        return jsonify({'message': 'Internal error'}), 500

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    try:
        db = get_db()
        
        # Check if user exists
        cursor = db.execute('SELECT id FROM users WHERE id = ?', (user_id,))
        if not cursor.fetchone():
            return jsonify({'message': 'User not found'}), 404
        
        # Prevent admin from deleting themselves
        if user_id == g.current_user['id']:
            return jsonify({'message': 'Cannot delete yourself'}), 400
        
        db.execute('DELETE FROM users WHERE id = ?', (user_id,))
        db.commit()
        
        return '', 200
    except Exception:
        return jsonify({'message': 'Internal error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)