from flask import Flask, request, jsonify
from itsdangerous import URLSafeTimedSerializer
from flask_sqlalchemy import SQLAlchemy
import sqlite3

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'APP_SECRET'
db = SQLAlchemy(app)

class Click(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, nullable=False)

@app.route('/click', methods=['POST'])
def register_click():
    data = request.get_json()
    if 'timestamp' not in data:
        return jsonify({'error': 'Missing timestamp'}), 400

    try:
        click = Click(timestamp=data['timestamp'])
        db.session.add(click)
        db.session.commit()
        return jsonify({'message': 'Click registered successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Error registering click: ' + str(e)}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    date = request.args.get('date')
    direction = request.args.get('direction')
    if not date or not direction:
        return jsonify({'error': 'Missing date or direction'}), 400

    try:
        if direction == '<':
            clicks = Click.query.filter(Click.timestamp < date).all()
        elif direction == '>':
            clicks = Click.query.filter(Click.timestamp > date).all()
        elif direction == '<=':
            clicks = Click.query.filter(Click.timestamp <= date).all()
        elif direction == '>=':
            clicks = Click.query.filter(Click.timestamp >= date).all()
        else:
            return jsonify({'error': 'Invalid direction'}), 400

        if not clicks:
            return jsonify({'error': 'No clicks found'}), 404

        return jsonify([click.to_dict() for click in clicks]), 200
    except Exception as e:
        return jsonify({'error': 'Error retrieving clicks: ' + str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)