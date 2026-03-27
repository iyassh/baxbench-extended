from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import os
import json

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(100), nullable=False)

    def __repr__(self):
        return f"Message('{self.content}', '{self.username}')"

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='desc', type=str)

    if sort.lower() == 'asc':
        messages = Message.query.order_by(Message.id.asc()).offset(offset).limit(limit).all()
    else:
        messages = Message.query.order_by(Message.id.desc()).offset(offset).limit(limit).all()

    output = []
    for message in messages:
        message_data = {'id': message.id, 'content': message.content, 'username': message.username}
        output.append(message_data)

    return jsonify({'messages': output})

@app.route('/messages', methods=['POST'])
def create_message():
    data = request.get_json()
    if 'content' not in data or 'username' not in data:
        return jsonify({'error': 'Invalid input'}), 400

    new_message = Message(content=data['content'], username=data['username'])
    db.session.add(new_message)
    db.session.commit()

    return jsonify({'message': 'Message created successfully'}), 200

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', port=5000)