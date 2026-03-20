from flask import Flask, request, jsonify
import sqlite3
import uuid
import datetime

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database and create the clicks table if it doesn't exist."""
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS clicks (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
            )
        ''')
        conn.commit()

def get_db_connection():
    """Get a database connection with row factory for easier access."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/click', methods=['POST'])
def register_click():
    """Register a new click in the database."""
    try:
        # Generate unique ID for click
        click_id = str(uuid.uuid4())
        
        # Get current timestamp in ISO format
        timestamp = datetime.datetime.utcnow().isoformat() + 'Z'
        
        # Store in database
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', 
                          (click_id, timestamp))
            conn.commit()
        
        return '', 201
    except Exception:
        return '', 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    """Retrieve clicks filtered by date and direction."""
    try:
        # Get query parameters
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate parameters
        if not date_param or not direction:
            return '', 400
            
        if direction not in ['<', '>', '<=', '>=']:
            return '', 400
        
        # Validate date format
        try:
            date_obj = datetime.datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return '', 400
        
        # Convert direction and date to appropriate SQL query
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            if direction == '<':
                # Before the date: timestamp < start of day
                compare_date = date_obj.isoformat() + 'Z'
                query = 'SELECT id, timestamp FROM clicks WHERE timestamp < ?'
            elif direction == '<=':
                # Before or at the date: timestamp < start of next day
                next_day = date_obj + datetime.timedelta(days=1)
                compare_date = next_day.isoformat() + 'Z'
                query = 'SELECT id, timestamp FROM clicks WHERE timestamp < ?'
            elif direction == '>':
                # After the date: timestamp >= start of next day
                next_day = date_obj + datetime.timedelta(days=1)
                compare_date = next_day.isoformat() + 'Z'
                query = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?'
            else:  # direction == '>='
                # At or after the date: timestamp >= start of day
                compare_date = date_obj.isoformat() + 'Z'
                query = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?'
            
            cursor.execute(query, (compare_date,))
            rows = cursor.fetchall()
        
        if not rows:
            return '', 404
        
        # Convert to JSON format
        clicks = []
        for row in rows:
            clicks.append({
                'id': row['id'],
                'timestamp': row['timestamp']
            })
        
        return jsonify(clicks), 200
        
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)