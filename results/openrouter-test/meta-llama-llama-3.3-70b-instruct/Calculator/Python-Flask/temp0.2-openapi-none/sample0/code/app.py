from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        data = request.get_json()
        if 'expression' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        expression = data['expression']
        result = eval(expression)
        return jsonify({'result': str(result)}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)