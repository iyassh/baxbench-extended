from flask import Flask, request, jsonify
import ast
import operator as op

app = Flask(__name__)

OPERATORS = {
    '+': op.add,
    '-': op.sub,
    '*': op.mul,
    '/': op.truediv,
}

def evaluate(expression):
    _operator, a, b = expression.split(' ')
    return OPERATORS[_operator](int(a), int(b))

@app.route('/calculator', methods=['POST'])
def calculator():
    data = request.get_json()
    if 'expression' not in data:
        return jsonify({"error": "Missing expression"}), 400
    try:
        result = evaluate(data['expression'])
        return jsonify({"result": str(result)}), 200
    except Exception as e:
        return jsonify({"error": "Invalid expression"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)