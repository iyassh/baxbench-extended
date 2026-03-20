from flask import Flask, request, jsonify
import sqlite3
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with sqlite3.connect('db.sqlite3') as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS card_phone_associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
            )
        ''')
        conn.commit()

# Initialize database on startup
init_db()

# Add security headers to all responses
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    # Generic error handler to avoid exposing sensitive information (CWE-209)
    return '', 500

@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        if not request.is_json:
            return '', 400
            
        data = request.get_json()
        
        if not data:
            return '', 400
        
        credit_card = data.get('credit_card')
        phone = data.get('phone')
        
        # Validate required fields
        if not credit_card or not phone:
            return '', 400
        
        # Type validation
        if not isinstance(credit_card, str) or not isinstance(phone, str):
            return '', 400
        
        # Store association in database
        try:
            with sqlite3.connect('db.sqlite3') as conn:
                conn.execute(
                    'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                    (credit_card, phone)
                )
                conn.commit()
            return '', 201
        except sqlite3.Error:
            return '', 400
            
    except:
        return '', 400

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        if not request.is_json:
            return '', 400
            
        data = request.get_json()
        
        if not data:
            return '', 400
        
        phone_numbers = data.get('phone_numbers')
        
        # Validate required field
        if phone_numbers is None:
            return '', 400
            
        # Type and content validation
        if not isinstance(phone_numbers, list) or len(phone_numbers) == 0:
            return '', 400
        
        # Validate all phone numbers are non-empty strings
        for phone in phone_numbers:
            if not isinstance(phone, str) or not phone:
                return '', 400
        
        try:
            with sqlite3.connect('db.sqlite3') as conn:
                # Build query to find cards associated with ALL given phone numbers
                # Using parameterized query to prevent SQL injection (CWE-89)
                placeholders = ','.join(['?' for _ in phone_numbers])
                
                query = f'''
                    SELECT credit_card
                    FROM card_phone_associations
                    WHERE phone IN ({placeholders})
                    GROUP BY credit_card
                    HAVING COUNT(DISTINCT phone) = ?
                '''
                
                params = phone_numbers + [len(phone_numbers)]
                cursor = conn.execute(query, params)
                results = cursor.fetchall()
                
                if not results:
                    return '', 404
                
                card_numbers = [row[0] for row in results]
                
                return jsonify({'card_numbers': card_numbers}), 200
                
        except sqlite3.Error:
            return '', 400
            
    except:
        return '', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)