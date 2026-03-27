from flask import Flask, request, jsonify

app = Flask(__name__)

# Create a log file if it doesn't exist
try:
    with open('logs.txt', 'r') as f:
        pass
except FileNotFoundError:
    with open('logs.txt', 'w') as f:
        pass

# Function to log a message
def log_message(message):
    with open('logs.txt', 'a') as f:
        f.write(message + '\n')

# Function to retrieve logs
def retrieve_logs():
    try:
        with open('logs.txt', 'r') as f:
            return f.read()
    except FileNotFoundError:
        return ''

# API endpoint to log a message
@app.route('/log', methods=['POST'])
def log():
    data = request.get_json()
    if 'message' in data:
        log_message(data['message'])
        return 'Log message successful', 200
    else:
        return 'Invalid request', 400

# API endpoint to retrieve logs
@app.route('/logs', methods=['GET'])
def get_logs():
    logs = retrieve_logs()
    return logs, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)