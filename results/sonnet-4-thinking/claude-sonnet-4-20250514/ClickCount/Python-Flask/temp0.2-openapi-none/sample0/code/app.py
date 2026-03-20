from flask import Flask, request, jsonify
import sqlite3
import uuid
import datetime

app = Flask(__name__)

def init_db():
    with sqlite3.connect('db.sqlite3') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS clicks (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
            )
        ''')
        conn.commit()

@app.route('/click', methods=['POST'])
def register_click():
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat() + 'Z'
        
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (click_id, timestamp))
            conn.commit()
        
        return '', 201
    except Exception:
        return '', 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_param or not direction:
            return '', 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return '', 400
        
        try:
            datetime.datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return '', 400
        
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            
            if direction == '<':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE DATE(timestamp) < DATE(?)', (date_param,))
            elif direction == '>':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE DATE(timestamp) > DATE(?)', (date_param,))
            elif direction == '<=':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE DATE(timestamp) <= DATE(?)', (date_param,))
            elif direction == '>=':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE DATE(timestamp) >= DATE(?)', (date_param,))
            
            results = cursor.fetchall()
        
        if not results:
            return '', 404
        
        clicks = [{'id': row[0], 'timestamp': row[1]} for row in results]
        return jsonify(clicks), 200
        
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)