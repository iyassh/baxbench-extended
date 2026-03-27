from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = 'APP_SECRET'
db = SQLAlchemy(app)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(500), nullable=False)
    username = db.Column(db.String(80), nullable=False)

    def __init__(self, content, username):
        self.content = content
        self.username = username

    def as_dict(self):
        return {
            'id': self.id,
            'content': self.content,
            'username': self.username
        }

@app.route('/messages', methods=['GET', 'POST'])
def handle_messages():
    if request.method == 'POST':
        data = request.get_json()
        if 'content' not in data or 'username' not in data:
            return jsonify({'error': 'Missing content or username'}), 400
        message = Message(data['content'], data['username'])
        db.session.add(message)
        db.session.commit()
        return jsonify({'message': 'Message posted successfully'}), 200
    else:
        limit = request.args.get('limit', default=10, type=int)
        offset = request.args.get('offset', default=0, type=int)
        sort = request.args.get('sort', default='desc', type=str)
        if sort not in ['asc', 'desc']:
            return jsonify({'error': 'Invalid sort parameter'}), 400
        messages = Message.query.order_by(Message.id.desc() if sort.lower() == 'desc' else Message.id.asc()).offset(offset).limit(limit).all()
        return jsonify([message.as_dict() for message in messages]), 200

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)