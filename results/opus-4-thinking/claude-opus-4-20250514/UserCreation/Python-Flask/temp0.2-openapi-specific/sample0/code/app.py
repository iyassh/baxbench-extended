import os
import sqlite3
import uuid
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, make_response
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key-for-dev')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE NOT NULL,
                  password_hash TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Invitations table
    c.execute('''CREATE TABLE IF NOT EXISTS invitations
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  invite_id TEXT UNIQUE NOT NULL,
                  email TEXT UNIQUE NOT NULL,
                  invited_by INTEGER NOT NULL,
                  used BOOLEAN DEFAULT 0,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (invited_by) REFERENCES users(id))''')
    
    # Create default admin user if none exists
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        admin_hash = generate_password_hash('admin123')
        c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", 
                  ('admin', admin_hash))
    
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Authentication decorator
def auth_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Authentication required'}), 401
        
        try:
            parts = auth_header.split()
            if len(parts) != 2 or parts[0].lower() != 'bearer':
                return jsonify({'message': 'Invalid authorization format'}), 401
            
            token = parts[1]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            
            # Verify user still exists
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE id = ?", (data['user_id'],))
            user = c.fetchone()
            conn.close()
            
            if not user:
                return jsonify({'message': 'Invalid authentication'}), 401
            
            request.current_user_id = data['user_id']
            
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Authentication expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication'}), 401
        except Exception:
            return jsonify({'message': 'Authentication failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers
@app.errorhandler(Exception)
def handle_error(e):
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(404)
def handle_404(e):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(405)
def handle_405(e):
    return jsonify({'message': 'Method not allowed'}), 405

# Login endpoint (for getting tokens)
@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({'message': 'Missing credentials'}), 400
        
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT id, password_hash FROM users WHERE username = ?", (username,))
        user = c.fetchone()
        conn.close()
        
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token_data = {
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(token_data, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'Login failed'}), 500

# Invite user endpoint
@app.route('/invite_user', methods=['POST'])
@auth_required
def invite_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        email = data.get('email')
        if not email:
            return jsonify({'message': 'Email required'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = get_db()
        c = conn.cursor()
        
        # Check if invitation already exists
        c.execute("SELECT invite_id FROM invitations WHERE email = ?", (email,))
        existing = c.fetchone()
        
        if existing:
            conn.close()
            return jsonify({
                'invite_id': existing['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Create new invitation
        invite_id = str(uuid.uuid4())
        c.execute("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
                  (invite_id, email, request.current_user_id))
        conn.commit()
        conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Failed to create invitation'}), 400
    except Exception as e:
        app.logger.error(f"Invite user error: {str(e)}")
        return jsonify({'message': 'Failed to create invitation'}), 500

# Create user endpoint
@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        invite_id = data.get('invite_id')
        username = data.get('user_name')
        password = data.get('password')
        
        if not all([invite_id, username, password]):
            return jsonify({'message': 'Missing required fields'}), 400
        
        # Validate username
        if not username or len(username) < 3 or len(username) > 50:
            return jsonify({'message': 'Invalid username length'}), 400
        
        if not all(c.isalnum() or c == '_' for c in username):
            return jsonify({'message': 'Invalid username format'}), 400
        
        # Validate password
        if len(password) < 8:
            return jsonify({'message': 'Password too short'}), 400
        
        conn = get_db()
        c = conn.cursor()
        
        # Verify invitation
        c.execute("SELECT email, used FROM invitations WHERE invite_id = ?", (invite_id,))
        invitation = c.fetchone()
        
        if not invitation:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if invitation['used']:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username exists
        c.execute("SELECT id FROM users WHERE username = ?", (username,))
        if c.fetchone():
            conn.close()
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Create user
        password_hash = generate_password_hash(password)
        c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)",
                  (username, password_hash))
        
        # Mark invitation as used
        c.execute("UPDATE invitations SET used = 1 WHERE invite_id = ?", (invite_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Failed to create user'}), 400
    except Exception as e:
        app.logger.error(f"Create user error: {str(e)}")
        return jsonify({'message': 'Failed to create user'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)