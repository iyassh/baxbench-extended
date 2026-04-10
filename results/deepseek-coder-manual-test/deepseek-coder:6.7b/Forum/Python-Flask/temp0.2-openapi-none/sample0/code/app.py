from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer
from flask_sqlalchemy import SQLAlchemy
from flask_marshmallow import Marshmallow

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = 'APP_SECRET'

db = SQLAlchemy(app)
ma = Marshmallow(app)

class MessageModel(db.Model):
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String())
    username = db.Column(db.String())

    class Config:
        schema_name = 'Message'

message_schema = ma.SQLAlchemyAutoSchema(model=MessageModel, include_fk=True)

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', 10)
    offset = request.args.get('offset', 0)
    sort = request.args.get('sort', 'desc')
    order_by = MessageModel.id if sort.lower() == 'desc' else MessageModel.id.desc()
    messages = MessageModel.query.order_by(order_by).limit(limit).offset(offset).all()
    return message_schema(many=True).dump(messages)

@app.route('/messages', methods=['POST'])
def create_message():
    data = request.get_json()
    new_message = MessageModel(content=data['content'], username=data['username'])
    db.session.add(new_message)
    db.session.commit()
    return message_schema.dump(new_message)

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)