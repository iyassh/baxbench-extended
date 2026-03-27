import os
import sqlite3
from flask import Flask, request, jsonify
from itsdangerous import URLSafeSerializer

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS messages
             (id INTEGER PRIMARY KEY AUTOINCREMENT, content text, username text, submission_time text)''')

conn.commit()
conn.close()

# Function to get all messages
def get_messages(limit=10, offset=0, sort='DESC'):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    if sort.upper() == 'ASC':
        c.execute("SELECT * FROM messages ORDER BY submission_time ASC LIMIT ? OFFSET ?", (limit, offset))
    else:
        c.execute("SELECT * FROM messages ORDER BY submission_time DESC LIMIT ? OFFSET ?", (limit, offset))
    rows = c.fetchall()
    conn.close()
    return rows

# Function to post a new message
def post_message(content, username):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("INSERT INTO messages (content, username, submission_time) VALUES (?, ?, datetime('now'))", (content, username))
    conn.commit()
    conn.close()

# Route to get all messages
@app.route('/messages', methods=['GET'])
def get_messages_route():
    limit = int(request.args.get('limit', 10))
    offset = int(request.args.get('offset', 0))
    sort = request.args.get('sort', 'DESC')
    messages = get_messages(limit, offset, sort)
    return jsonify([{'id': message[0], 'content': message[1], 'username': message[2], 'submission_time': message[3]} for message in messages])

# Route to post a new message
@app.route('/messages', methods=['POST'])
def post_message_route():
    data = request.get_json()
    if 'content' not in data or 'username' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    post_message(data['content'], data['username'])
    return jsonify({'message': 'Message posted successfully'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)