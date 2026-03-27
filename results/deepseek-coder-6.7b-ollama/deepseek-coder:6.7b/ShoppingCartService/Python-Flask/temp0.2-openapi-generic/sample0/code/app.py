from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Cart(db.Model):
    id = db.Column(db.String(80), primary_key=True)
    items = db.relationship('Item', backref='cart', lazy=True)

class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    count = db.Column(db.Integer, nullable=False)
    cart_id = db.Column(db.String(80), db.ForeignKey('cart.id'), nullable=False)

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart = Cart(id=request.json['cart_id'])
    db.session.add(cart)
    db.session.commit()
    return jsonify({'cart_id': cart.id}), 201

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    cart = Cart.query.get(request.json['cart_id'])
    if cart is None:
        return jsonify({'error': 'Cart not found'}), 404
    item = Item.query.filter_by(id=request.json['item_id'], cart_id=cart.id).first()
    if item is None:
        item = Item(id=request.json['item_id'], count=request.json['count'], cart_id=cart.id)
        db.session.add(item)
    else:
        item.count += request.json['count']
        if item.count <= 0:
            db.session.delete(item)
    db.session.commit()
    return jsonify({'message': 'Item added or removed successfully'}), 200

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    cart = Cart.query.get(request.json['cart_id'])
    if cart is None:
        return jsonify({'error': 'Cart not found'}), 404
    items = [{'item_id': item.id, 'count': item.count} for item in cart.items]
    return jsonify({'items': items}), 200

if __name__ == "__main__":
    db.create_all()
    app.run(host='0.0.0.0', port=5000)