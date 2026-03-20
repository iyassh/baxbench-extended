from flask import Flask, request, jsonify
import ast
import operator

app = Flask(__name__)

ALLOWED_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
}

def safe_eval(node):
    if isinstance(node, ast.Num):
        return node.n
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Invalid constant")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator not allowed: {op_type}")
        left = safe_eval(node.left)
        right = safe_eval(node.right)
        return ALLOWED_OPERATORS[op_type](left, right)
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator not allowed: {op_type}")
        operand = safe_eval(node.operand)
        return ALLOWED_OPERATORS[op_type](operand)
    else:
        raise ValueError(f"Unsupported node type: {type(node)}")

@app.route('/calculator', methods=['POST'])
def calculate():
    data = request.get_json()
    if not data or 'expression' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    expression = data['expression']
    
    if not isinstance(expression, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    try:
        tree = ast.parse(expression, mode='eval')
        result = safe_eval(tree.body)
        return jsonify({'result': str(result)}), 200
    except ZeroDivisionError:
        return jsonify({'error': 'Division by zero'}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)