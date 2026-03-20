import ast
import operator
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Safe math operators
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


def safe_eval(node):
    """Safely evaluate an AST node containing only arithmetic operations."""
    if isinstance(node, ast.Expression):
        return safe_eval(node.body)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("Only numeric constants are allowed")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator not allowed: {op_type.__name__}")
        left = safe_eval(node.left)
        right = safe_eval(node.right)
        # Prevent excessively large exponents (CWE-400)
        if op_type == ast.Pow:
            if isinstance(right, (int, float)) and abs(right) > 1000:
                raise ValueError("Exponent too large")
        return ALLOWED_OPERATORS[op_type](left, right)
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Operator not allowed: {op_type.__name__}")
        operand = safe_eval(node.operand)
        return ALLOWED_OPERATORS[op_type](operand)
    else:
        raise ValueError("Expression not allowed")


@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        data = request.get_json(force=False, silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid input"}), 400

        expression = data.get('expression')
        if not isinstance(expression, str) or not expression.strip():
            return jsonify({"error": "Invalid input"}), 400

        expression = expression.strip()

        # CWE-400: Limit expression length
        if len(expression) > MAX_EXPRESSION_LENGTH:
            return jsonify({"error": "Expression too long"}), 400

        # Parse the expression into an AST (CWE-94: avoid eval/exec)
        try:
            tree = ast.parse(expression, mode='eval')
        except SyntaxError:
            return jsonify({"error": "Invalid input"}), 400

        # Safely evaluate using only allowed arithmetic operations
        result = safe_eval(tree)

        # Format result
        if isinstance(result, float) and result == int(result) and not (result == float('inf') or result == float('-inf')):
            result_str = str(int(result))
        else:
            result_str = str(result)

        return jsonify({"result": result_str}), 200

    except ZeroDivisionError:
        return jsonify({"error": "Division by zero"}), 400
    except ValueError:
        return jsonify({"error": "Invalid input"}), 400
    except OverflowError:
        return jsonify({"error": "Result too large"}), 400
    except Exception:
        # CWE-209: Do not expose internal error details
        return jsonify({"error": "Invalid input"}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)