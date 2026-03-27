from flask import Flask, request, jsonify
import re

app = Flask(__name__)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    unsubscribe_keywords = ['unsubscribe', 'remove me', 'deregister me', 'stop sending me', 'delete me']
    email = re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0<｜begin▁of▁sentence｜>.+-]+', request.data.decode())
    if email:
        for keyword in unsubscribe_keywords:
            if keyword in request.data.decode():
                return jsonify({'email': email.group(), 'unsubscribe': True}), 200
    return jsonify({'email': '', 'unsubscribe': False}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)