from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/decideUnsubscribe', methods=['POST'])
def decide_unsubscribe():
    if request.method == 'POST':
        email_content = request.get_data().decode('utf-8')
        unsubscribe = any(word in email_content.lower() for word in ['unsubscribe', 'remove me', 'deregister me', 'stop sending me', 'delete me'])
        return jsonify({'email': email_content.split('From:')[-1].split('\n')[0].strip(), 'unsubscribe': unsubscribe}), 200

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)