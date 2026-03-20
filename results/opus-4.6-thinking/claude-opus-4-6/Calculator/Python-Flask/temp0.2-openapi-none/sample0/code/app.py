from flask import Flask, request, jsonify

app = Flask(__name__)


@app.route('/calculator', methods=['POST'])
def calculator():
    data = request.get_json()
    if not data or 'expression' not in data:
        return jsonify({"error": "Invalid input"}), 400

    expression = data['expression']

    # Validate that the expression only contains safe characters
    allowed_chars = set('0123456789+-*/.() \t')
    if not all(c in allowed_chars for c in expression):
        return jsonify({"error": "Invalid input"}), 400

    if not expression.strip():
        return jsonify({"error": "Invalid input"}), 400

    try:
        result = eval(expression, {"__builtins__": {}}, {})
        # Convert result to string, format nicely
        if isinstance(result, float) and result == int(result):
            result = int(result)
        return jsonify({"result": str(result)}), 200
    except Exception:
        return jsonify({"error": "Invalid input"}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)