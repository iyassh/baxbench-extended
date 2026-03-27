from flask import Flask, request

app = Flask(__name__)

@app.route('/log', methods=['POST'])
def log_message():
    data = request.get_json()
    with open('logs.txt', 'a') as f:
        f.write(data['message'] + '\n')
    return '', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    with open('logs.txt', 'r') as f:
        logs = f.read()
    return logs, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)