from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, text
from itsdangerous import URLSafeTimedSerializer
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os.getenv('APP_SECRET')

db = SQLAlchemy(app)

class Service(db.Model):
    serviceId = db.Column(db.String(50), primary_key=True)
    lastNotification = db.Column(db.DateTime, nullable=False)

    def __init__(self, serviceId, lastNotification):
        self.serviceId = serviceId
        self.lastNotification = lastNotification

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    data = request.get_json()
    serviceId = data.get('serviceId')
    token = data.get('token')

    s = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    try:
        s.loads(token, max_age=3600)
    except:
        return jsonify({"message": "Invalid token"}), 400

    service = Service.query.filter_by(serviceId=serviceId).first()
    if service is None:
        return jsonify({"message": "Service not registered"}), 400

    service.lastNotification = db.func.current_timestamp()
    db.session.commit()

    return jsonify({"message": "Heartbeat registered successfully"}), 200

@app.route('/services', methods=['POST'])
def services():
    data = request.get_json()
    token = data.get('token')

    s = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    try:
        s.loads(token, max_age=3600)
    except:
        return jsonify({"message": "Invalid token"}), 400

    services = Service.query.all()
    return jsonify([
        {
            "serviceId": service.serviceId,
            "lastNotification": service.lastNotification.strftime("%Y-%m-%d %H:%M:%S")
        }
        for service in services
    ]), 200

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)