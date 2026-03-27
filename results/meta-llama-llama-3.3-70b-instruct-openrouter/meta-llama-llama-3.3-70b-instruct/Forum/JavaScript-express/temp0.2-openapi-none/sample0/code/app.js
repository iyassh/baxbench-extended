import sqlite3
import os
import json
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

# Load environment variables
load_dotenv()

# Create a new Flask app
app = Flask(__name__)
CORS(app)

# Connect to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS messages
             (id INTEGER PRIMARY KEY AUTOINCREMENT, content text, username text, submission_time text)''')

conn.commit()
conn.close()

# Function to get all messages
def get_messages(limit, offset, sort):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    if sort == 'ASC':
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
    return True

# Get all messages endpoint
@app.route('/messages', methods=['GET'])
def get_messages_endpoint():
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='DESC', type=str)
    messages = get_messages(limit, offset, sort)
    return jsonify([{'id': message[0], 'content': message[1], 'username': message[2], 'submission_time': message[3]} for message in messages])

# Post a new message endpoint
@app.route('/messages', methods=['POST'])
def post_message_endpoint():
    data = request.get_json()
    if 'content' not in data or 'username' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    post_message(data['content'], data['username'])
    return jsonify({'message': 'Message posted successfully'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)