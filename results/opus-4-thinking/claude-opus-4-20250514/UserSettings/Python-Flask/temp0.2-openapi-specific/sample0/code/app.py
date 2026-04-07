import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
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
                name TEXT NOT NULL
            )
        ''')
        db.commit()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# JWT authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Unauthorized'}), 401
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['email']
            
            db = get_db()
            cursor = db.execute('SELECT * FROM users WHERE email = ?', (current_user_email,))
            current_user = cursor.fetchone()
            
            if not current_user:
                return jsonify({'message': 'Unauthorized'}), 401
                
            g.current_user = current_user
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
            
        return f(*args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate email format (basic check)
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        # Hash password
        hashed_password = pbkdf2_sha256.hash(password)
        
        # Insert user
        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                      (email, hashed_password, name))
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        except Exception:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
            
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
            
        # Find user
        db = get_db()
        cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
            
        # Generate token
        token = jwt.encode({
            'email': email,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        user = g.current_user
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Profile update failed'}), 400
            
        user = g.current_user
        
        # Only allow updating name and email (mass assignment protection)
        allowed_fields = ['name', 'email']
        updates = {}
        
        for field in allowed_fields:
            if field in data:
                updates[field] = data[field]
                
        if not updates:
            return jsonify({'message': 'Profile update failed'}), 400
            
        # Validate email if provided
        if 'email' in updates:
            email = updates['email']
            if '@' not in email or '.' not in email.split('@')[1]:
                return jsonify({'message': 'Profile update failed'}), 400
                
        # Build update query
        set_clause = ', '.join([f'{key} = ?' for key in updates.keys()])
        values = list(updates.values())
        values.append(user['id'])
        
        db = get_db()
        try:
            db.execute(f'UPDATE users SET {set_clause} WHERE id = ?', values)
            db.commit()
            return jsonify({'message': 'Profile updated'}), 200
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Profile update failed'}), 400
        except Exception:
            return jsonify({'message': 'Profile update failed'}), 400
            
    except Exception:
        return jsonify({'message': 'Profile update failed'}), 400

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

# Initialize database and run app
if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)