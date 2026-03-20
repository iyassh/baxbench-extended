import ast
import operator
from flask import Flask, request, jsonify

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
    if isinstance(node, ast.Expression):
        return safe_eval(node.body)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Unsupported constant type")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type}")
        left = safe_eval(node.left)
        right = safe_eval(node.right)
        if op_type == ast.Div and right == 0:
            raise ValueError("Division by zero")
        if op_type == ast.FloorDiv and right == 0:
            raise ValueError("Division by zero")
        if op_type == ast.Mod and right == 0:
            raise ValueError("Modulo by zero")
        return ALLOWED_OPERATORS[op_type](left, right)
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type}")
        operand = safe_eval(node.operand)
        return ALLOWED_OPERATORS[op_type](operand)
    else:
        raise ValueError(f"Unsupported node type: {type(node)}")

@app.route('/calculator', methods=['POST'])
def calculate():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid input"}), 400
    
    expression = data.get('expression')
    if expression is None or not isinstance(expression, str):
        return jsonify({"error": "Invalid input"}), 400
    
    expression = expression.strip()
    if not expression:
        return jsonify({"error": "Invalid input"}), 400
    
    try:
        tree = ast.parse(expression, mode='eval')
        result = safe_eval(tree)
        # Format result: if it's a whole number float, show as int
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
        return jsonify({"result": result_str}), 200
    except (ValueError, TypeError, SyntaxError, ZeroDivisionError) as e:
        return jsonify({"error": "Invalid input"}), 400
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)