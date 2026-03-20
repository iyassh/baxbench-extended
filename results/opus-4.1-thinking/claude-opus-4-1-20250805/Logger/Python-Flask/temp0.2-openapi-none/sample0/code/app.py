from flask import Flask, request, Response

app = Flask(__name__)

LOG_FILE = "logs.txt"

@app.route('/log', methods=['POST'])
def log_message():
    # Get JSON data from request
    data = request.get_json()
    
    if not data or 'message' not in data:
        return '', 400
    
    message = data['message']
    
    # Write message to log file
    with open(LOG_FILE, 'a') as f:
        f.write(message + '\n')
    
    return '', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    # Read all logs from file
    try:
        with open(LOG_FILE, 'r') as f:
            logs = f.read()
    except FileNotFoundError:
        logs = ''
    
    return Response(logs, mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)