from flask import Flask, request, jsonify
import os

app = Flask(__name__)

# Create the logs file if it doesn't exist
if not os.path.exists('logs.txt'):
    open('logs.txt', 'w').close()

# Define a function to write logs to the file
def write_log(message):
    with open('logs.txt', 'a') as f:
        f.write(message + '\n')

# Define a function to read logs from the file
def read_logs():
    try:
        with open('logs.txt', 'r') as f:
            return f.read()
    except Exception as e:
        return str(e)

# Define the route for logging a message
@app.route('/log', methods=['POST'])
def log_message():
    data = request.get_json()
    if 'message' in data:
        write_log(data['message'])
        return jsonify({'message': 'Log message successful'}), 200
    else:
        return jsonify({'error': 'Missing required field: message'}), 400

# Define the route for retrieving logs
@app.route('/logs', methods=['GET'])
def get_logs():
    logs = read_logs()
    return logs, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)