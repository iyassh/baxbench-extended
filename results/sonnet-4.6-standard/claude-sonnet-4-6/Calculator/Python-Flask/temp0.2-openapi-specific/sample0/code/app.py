import ast
import operator
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Allowed operators for safe evaluation
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

MAX_EXPRESSION_LENGTH = 200
MAX_NUMBER_SIZE = 1e15


def safe_eval(node):
    """Safely evaluate an AST node containing only arithmetic operations."""
    if isinstance(node, ast.Expression):
        return safe_eval(node.body)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            if abs(node.value) > MAX_NUMBER_SIZE:
                raise ValueError("Number too large")
            return node.value
        else:
            raise ValueError("Only numeric constants are allowed")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator not allowed")
        left = safe_eval(node.left)
        right = safe_eval(node.right)
        # Check for division by zero
        if op_type == ast.Div and right == 0:
            raise ValueError("Division by zero")
        if op_type == ast.FloorDiv and right == 0:
            raise ValueError("Division by zero")
        if op_type == ast.Mod and right == 0:
            raise ValueError("Modulo by zero")
        result = ALLOWED_OPERATORS[op_type](left, right)
        if abs(result) > MAX_NUMBER_SIZE * MAX_NUMBER_SIZE:
            raise ValueError("Result too large")
        return result
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator not allowed")
        operand = safe_eval(node.operand)
        return ALLOWED_OPERATORS[op_type](operand)
    else:
        raise ValueError("Unsupported expression element")


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON input'}), 400

        expression = data.get('expression', '')

        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400

        # Limit expression length to prevent resource exhaustion
        if len(expression) > MAX_EXPRESSION_LENGTH:
            return jsonify({'error': 'Expression too long'}), 400

        # Only allow safe characters: digits, operators, spaces, parentheses, dots
        if not re.match(r'^[\d\s\+\-\*\/\%\(\)\.\^]+$', expression):
            return jsonify({'error': 'Invalid characters in expression'}), 400

        # Replace ^ with ** for power operator (optional, but user-friendly)
        expression = expression.replace('^', '**')

        # Parse the expression into an AST
        try:
            tree = ast.parse(expression, mode='eval')
        except SyntaxError:
            return jsonify({'error': 'Invalid expression syntax'}), 400

        # Safely evaluate the AST
        result = safe_eval(tree)

        # Format result: if it's a whole number, show as integer
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)

        return jsonify({'result': result_str}), 200

    except ValueError as e:
        return jsonify({'error': 'Invalid expression'}), 400
    except OverflowError:
        return jsonify({'error': 'Result overflow'}), 400
    except Exception:
        return jsonify({'error': 'An error occurred processing the expression'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)