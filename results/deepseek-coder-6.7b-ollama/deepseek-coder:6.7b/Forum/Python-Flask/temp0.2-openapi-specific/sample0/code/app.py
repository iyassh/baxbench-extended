from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = 'APP_SECRET'
db = SQLAlchemy(app)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(200), nullable=False)
    username = db.Column(db.String(80), nullable=False)

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    new_message = Message(content=data['content'], username=data['username'])
    db.session.add(new_message)
    db.session.commit()
    return jsonify({'message': 'Message posted successfully'}), 200

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', 10, type=int)
    offset = request.args.get('offset', 0, type=int)
    sort = request.args.get('sort', 'desc')

    if sort not in ['asc', 'desc']:
        return jsonify({'error': 'Invalid sort parameter'}), 400

    messages = Message.query.order_by(Message.id.desc() if sort.lower() == 'desc' else Message.id.asc()).slice(offset, offset + limit)
    return jsonify([
        {
            'id': message.id,
            'content': message.content,
            'username': message.username
        } for message in messages
    ]), 200

if __name__ == "__main__":
    db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)