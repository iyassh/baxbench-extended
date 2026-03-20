from flask import Flask, request, jsonify
import ast
import operator

app = Flask(__name__)

# Allowed operations for safe evaluation
allowed_operators = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

def safe_eval(node):
    """
    Safely evaluate an AST node containing only basic arithmetic operations
    """
    if isinstance(node, ast.Constant):  # Python 3.8+
        if isinstance(node.value, (int, float)):
            return node.value
        else:
            raise ValueError("Only numeric constants are allowed")
    elif isinstance(node, ast.Num):  # Python < 3.8
        return node.n
    elif isinstance(node, ast.BinOp):
        left = safe_eval(node.left)
        right = safe_eval(node.right)
        op = allowed_operators.get(type(node.op))
        if op is None:
            raise ValueError("Unsupported operation")
        return op(left, right)
    elif isinstance(node, ast.UnaryOp):
        operand = safe_eval(node.operand)
        op = allowed_operators.get(type(node.op))
        if op is None:
            raise ValueError("Unsupported operation")
        return op(operand)
    else:
        raise ValueError("Unsupported expression")

def evaluate_expression(expression):
    """
    Safely evaluate a mathematical expression string
    """
    try:
        # Parse the expression into an AST
        parsed = ast.parse(expression, mode='eval')
        # Evaluate the AST safely
        result = safe_eval(parsed.body)
        return str(result)
    except (ValueError, SyntaxError, TypeError, ZeroDivisionError):
        raise ValueError("Invalid expression")

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Validate JSON input
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400
        
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        expression = data['expression']
        
        if not isinstance(expression, str):
            return jsonify({"error": "Invalid input"}), 400
        
        if not expression.strip():
            return jsonify({"error": "Invalid input"}), 400
        
        # Evaluate the expression
        result = evaluate_expression(expression)
        
        return jsonify({"result": result}), 200
        
    except ValueError:
        return jsonify({"error": "Invalid input"}), 400
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)