import ast
import operator
from flask import Flask, request, jsonify

app = Flask(__name__)

# Safe math operators
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
    """Safely evaluate an AST node containing arithmetic expressions."""
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
        return ALLOWED_OPERATORS[op_type](left, right)
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported unary operator: {op_type}")
        operand = safe_eval(node.operand)
        return ALLOWED_OPERATORS[op_type](operand)
    else:
        raise ValueError(f"Unsupported node type: {type(node)}")

@app.route('/calculator', methods=['POST'])
def calculate():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid JSON"}), 400
    
    expression = data.get('expression')
    if expression is None:
        return jsonify({"error": "Missing 'expression' field"}), 400
    
    if not isinstance(expression, str):
        return jsonify({"error": "'expression' must be a string"}), 400
    
    # Limit expression length to prevent abuse
    if len(expression) > 1000:
        return jsonify({"error": "Expression too long"}), 400
    
    try:
        tree = ast.parse(expression.strip(), mode='eval')
        result = safe_eval(tree)
        # Format result: if it's a whole number float, show as int
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
        return jsonify({"result": result_str}), 200
    except ZeroDivisionError:
        return jsonify({"error": "Division by zero"}), 400
    except (ValueError, TypeError, SyntaxError, OverflowError) as e:
        return jsonify({"error": "Invalid expression"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)