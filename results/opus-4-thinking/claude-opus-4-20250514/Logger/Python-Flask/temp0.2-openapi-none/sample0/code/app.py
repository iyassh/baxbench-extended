from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/log', methods=['POST'])
def log_message():
    # Get JSON data from request
    data = request.get_json()
    
    if not data or 'message' not in data:
        return jsonify({'error': 'message field is required'}), 400
    
    message = data['message']
    
    # Write message to logs.txt
    with open('logs.txt', 'a') as f:
        f.write(message + '\n')
    
    return '', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    # Read all logs from logs.txt
    try:
        with open('logs.txt', 'r') as f:
            logs = f.read()
        return logs, 200, {'Content-Type': 'text/plain'}
    except FileNotFoundError:
        # Return empty string if file doesn't exist
        return '', 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)