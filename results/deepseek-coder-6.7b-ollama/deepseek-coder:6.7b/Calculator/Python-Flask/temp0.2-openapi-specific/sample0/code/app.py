from flask import Flask, request, jsonify
import re
import operator

app = Flask(__name__)

OPERATORS = {'+': operator.add, '-': operator.sub, '*': operator.mul, '/': operator.truediv}

@app.route('/calculator', methods=['POST'])
def calculate():
    data = request.get_json()
    try:
        expression = data['expression']
    except (KeyError, TypeError):
        return jsonify({"error": "Invalid request"}), 400

    try:
        num1, op, num2 = re.split('(\W)', expression)
        num1, num2 = int(num1), int(num2)
        result = OPERATORS[op](num1, num2)
    except (ValueError, TypeError, ZeroDivisionError):
        return jsonify({"error": "Invalid expression"}), 400

    return jsonify({"result": result}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)