from flask import Flask, request, jsonify
import ast
import operator

app = Flask(__name__)

# Safe operators for arithmetic expressions
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

def safe_eval(expr):
    """Safely evaluate an arithmetic expression"""
    try:
        node = ast.parse(expr, mode='eval')
        return _eval_node(node.body)
    except Exception as e:
        raise ValueError(f"Invalid expression: {e}")

def _eval_node(node):
    """Recursively evaluate AST nodes"""
    if isinstance(node, ast.Num):
        return node.n
    elif isinstance(node, ast.Constant):
        return node.value
    elif isinstance(node, ast.BinOp):
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        op = SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operation: {type(node.op)}")
        return op(left, right)
    elif isinstance(node, ast.UnaryOp):
        operand = _eval_node(node.operand)
        op = SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operation: {type(node.op)}")
        return op(operand)
    else:
        raise ValueError(f"Unsupported node type: {type(node)}")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        data = request.get_json()
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing expression field"}), 400
        
        expression = data['expression']
        result = safe_eval(expression)
        
        return jsonify({"result": str(result)}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)