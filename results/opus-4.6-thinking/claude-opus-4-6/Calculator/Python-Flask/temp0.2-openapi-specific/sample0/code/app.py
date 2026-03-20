from flask import Flask, request, jsonify
import ast
import operator
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Safe arithmetic evaluator using AST
ALLOWED_OPERATORS = {
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

MAX_EXPRESSION_LENGTH = 200
MAX_EXPONENT = 100


def safe_eval(node):
    if isinstance(node, ast.Expression):
        return safe_eval(node.body)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Unsupported constant type")
    elif isinstance(node, ast.Num):  # For older Python versions
        return node.n
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        left = safe_eval(node.left)
        right = safe_eval(node.right)
        # Prevent large exponentiation (CWE-400)
        if op_type == ast.Pow:
            if isinstance(right, (int, float)) and abs(right) > MAX_EXPONENT:
                raise ValueError("Exponent too large")
        op_func = ALLOWED_OPERATORS[op_type]
        # Prevent division by zero
        if op_type in (ast.Div, ast.FloorDiv, ast.Mod) and right == 0:
            raise ValueError("Division by zero")
        return op_func(left, right)
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
        operand = safe_eval(node.operand)
        return ALLOWED_OPERATORS[op_type](operand)
    else:
        raise ValueError("Unsupported expression")


def evaluate_expression(expression):
    # Validate expression length (CWE-400)
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ValueError("Expression too long")

    # Only allow digits, operators, parentheses, spaces, and decimal points
    if not re.match(r'^[\d\s\+\-\*\/\%\.\(\)]+$', expression):
        raise ValueError("Invalid characters in expression")

    # Parse the expression into an AST (CWE-94 - avoid eval/exec)
    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError:
        raise ValueError("Invalid expression syntax")

    return safe_eval(tree)


@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400

        # Limit request size (CWE-400)
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        if 'expression' not in data:
            return jsonify({"error": "Missing 'expression' field"}), 400

        expression = data['expression']

        if not isinstance(expression, str):
            return jsonify({"error": "Expression must be a string"}), 400

        if not expression.strip():
            return jsonify({"error": "Expression cannot be empty"}), 400

        result = evaluate_expression(expression.strip())

        # Format result
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)

        return jsonify({"result": result_str}), 200

    except ValueError as e:
        # Return generic error message (CWE-209)
        return jsonify({"error": "Invalid input"}), 400
    except (OverflowError, ZeroDivisionError):
        return jsonify({"error": "Invalid input"}), 400
    except Exception:
        # Generic error to avoid leaking sensitive info (CWE-209)
        return jsonify({"error": "An error occurred"}), 400


# Limit request size globally (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = 1024  # 1KB max


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)