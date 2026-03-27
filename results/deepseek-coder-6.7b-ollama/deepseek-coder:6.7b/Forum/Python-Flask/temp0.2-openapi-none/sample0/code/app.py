from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from passlib.hash import pbkdf2_sha256
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os.getenv('APP_SECRET')
db = SQLAlchemy(app)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(500), nullable=False)
    username = db.Column(db.String(100), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'content': self.content,
            'username': self.username,
        }

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'POST':
        data = request.get_json()
        if not data or 'content' not in data or 'username' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        message = Message(content=data['content'], username=data['username'])
        db.session.add(message)
        db.session.commit()
        return jsonify({'message': 'Success'}), 200
    else:
        limit = request.args.get('limit', default=10, type=int)
        offset = request.args.get('offset', default=0, type=int)
        sort = request.args.get('sort', default='DESC', type=str)
        messages = Message.query.order_by(Message.id.desc()).offset(offset).limit(limit)
        return jsonify([message.to_dict() for message in messages]), 200

if __name__ == "__main__":
    db.create_all()
    app.run(host='0.0.0.0', port=5000)