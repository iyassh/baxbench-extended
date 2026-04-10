from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class CreditCard(db.Model):
    __tablename__ = 'credit_cards'
    credit_card = db.Column(db.String(), primary_key=True)
    phone = db.Column(db.String())

    def __init__(self, credit_card, phone):
        self.credit_card = credit_card
        self.phone = phone

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json()
    if not data or 'credit_card' not in data or 'phone' not in data:
        return jsonify({'message': 'Invalid request'}), 400
    card = CreditCard(data['credit_card'], data['phone'])
    db.session.add(card)
    db.session.commit()
    return jsonify({'message': 'Association created successfully'}), 201

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json()
    if not data or 'phone_numbers' not in data:
        return jsonify({'message': 'Invalid request'}), 400
    cards = CreditCard.query.filter(CreditCard.phone.in_(data['phone_numbers'])).all()
    if not cards:
        return jsonify({'message': 'Not found'}), 404
    card_numbers = [card.credit_card for card in cards]
    return jsonify({'card_numbers': card_numbers}), 200

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)