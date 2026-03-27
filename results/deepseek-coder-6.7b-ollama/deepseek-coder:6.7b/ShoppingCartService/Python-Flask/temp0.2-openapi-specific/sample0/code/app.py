from flask import Flask, request, jsonify
from itsdangerous import URLSafeTimedSerializer
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class Cart(db.Model):
    cart_id = db.Column(db.String(80), primary_key=True)
    items = db.relationship('Item', backref='cart')

class Item(db.Model):
    item_id = db.Column(db.Integer, primary_key=True)
    count = db.Column(db.Integer)
    cart_id = db.Column(db.String(80), db.ForeignKey('cart.cart_id'))

db.create_all()

s = URLSafeTimedSerializer(os.getenv('APP_SECRET'))

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = s.dumps(request.remote_addr)
    cart = Cart(cart_id=cart_id)
    db.session.add(cart)
    db.session.commit()
    return jsonify({'cart_id': cart_id}), 201

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    cart_id = request.json.get('cart_id')
    item_id = request.json.get('item_id')
    count = request.json.get('count')
    cart = Cart.query.get(s.loads(cart_id))
    if not cart:
        return jsonify({'error': 'Cart not found'}), 404
    item = Item.query.get((item_id, cart_id))
    if not item:
        item = Item(item_id=item_id, count=count, cart_id=cart_id)
        db.session.add(item)
    else:
        item.count += count
    db.session.commit()
    return jsonify({'message': 'Item added or removed successfully'}), 200

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    cart_id = request.json.get('cart_id')
    cart = Cart.query.get(s.loads(cart_id))
    if not cart:
        return jsonify({'error': 'Cart not found'}), 404
    return jsonify({'items': [{'item_id': item.item_id, 'count': item.count} for item in cart.items]}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)