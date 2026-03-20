import ast
import operator
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

# Supported operators
OPERATORS = {
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
MAX_NUMBER_SIZE = 1e308


def safe_eval(node, depth=0):
    """Safely evaluate an AST node for arithmetic expressions only."""
    if depth > 50:
        raise ValueError("Expression too complex")
    
    if isinstance(node, ast.Expression):
        return safe_eval(node.body, depth + 1)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            if abs(node.value) > MAX_NUMBER_SIZE:
                raise ValueError("Number too large")
            return node.value
        else:
            raise ValueError("Unsupported constant type")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        left = safe_eval(node.left, depth + 1)
        right = safe_eval(node.right, depth + 1)
        if op_type == ast.Div and right == 0:
            raise ValueError("Division by zero")
        if op_type == ast.FloorDiv and right == 0:
            raise ValueError("Division by zero")
        if op_type == ast.Mod and right == 0:
            raise ValueError("Modulo by zero")
        if op_type == ast.Pow:
            # Limit power operations to prevent resource exhaustion
            if isinstance(right, (int, float)) and abs(right) > 1000:
                raise ValueError("Exponent too large")
            if isinstance(left, (int, float)) and abs(left) > 1e10 and isinstance(right, (int, float)) and abs(right) > 10:
                raise ValueError("Result would be too large")
        result = OPERATORS[op_type](left, right)
        if isinstance(result, float) and (result != result or result == float('inf') or result == float('-inf')):
            raise ValueError("Result is not a finite number")
        return result
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in OPERATORS:
            raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
        operand = safe_eval(node.operand, depth + 1)
        return OPERATORS[op_type](operand)
    else:
        raise ValueError(f"Unsupported expression type: {type(node).__name__}")


def calculate_expression(expression):
    """Parse and evaluate a mathematical expression safely."""
    if not expression or not isinstance(expression, str):
        raise ValueError("Expression must be a non-empty string")
    
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ValueError("Expression too long")
    
    # Only allow safe characters: digits, operators, parentheses, spaces, dots
    if not re.match(r'^[\d\s\+\-\*\/\(\)\.\%\^]+$', expression):
        raise ValueError("Expression contains invalid characters")
    
    # Replace ^ with ** for power operator (optional, but user-friendly)
    expression = expression.replace('^', '**')
    
    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError:
        raise ValueError("Invalid expression syntax")
    
    result = safe_eval(tree)
    return result


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
def calculator():
    """Calculate the result of an arithmetic expression."""
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON input'}), 400
        
        if 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data['expression']
        
        result = calculate_expression(expression)
        
        # Format result: return int if it's a whole number
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
        
        return jsonify({'result': result_str}), 200
    
    except ValueError as e:
        return jsonify({'error': 'Invalid expression'}), 400
    except Exception:
        return jsonify({'error': 'An error occurred processing the request'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)