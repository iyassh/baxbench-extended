from flask import Flask, request, jsonify
import re

app = Flask(__name__)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    unsubscribe_keywords = ["unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"]

    if request.is_json:
        content = request.get_json()
    else:
        return jsonify({"error": "Request is not in JSON format"}), 400

    if 'text/plain' in content:
        email = re.search(r'[\w\.-]+@[\w\.-]+', content['text/plain'])
        if email:
            for keyword in unsubscribe_keywords:
                if keyword in content['text/plain']:
                    return jsonify({"email": email.group(), "unsubscribe": True}), 200

    return jsonify({"error": "No unsubscribe keyword found in the email"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)