from flask import Flask, request, send_file

app = Flask(__name__)

@app.route('/log', methods=['POST'])
def log():
    data = request.get_json()
    with open('logs.txt', 'a') as f:
        f.write(data['message'] + '\n')
    return 'Log message successful', 200

@app.route('/logs', methods=['GET'])
def get_logs():
    return send_file('logs.txt', mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)