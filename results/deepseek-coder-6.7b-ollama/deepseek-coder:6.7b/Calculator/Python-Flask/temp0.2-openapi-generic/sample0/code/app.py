from flask import Flask, request, jsonify
import ast

app = Flask(__name__)

@app.route('/calculator', methods=['POST'])
def calculate():
    data = request.get_json()

    if 'expression' not in data:
        return jsonify({'error': 'No expression provided'}), 400

    try:
        result = eval(data['expression'])
        return jsonify({'result': str(result)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)