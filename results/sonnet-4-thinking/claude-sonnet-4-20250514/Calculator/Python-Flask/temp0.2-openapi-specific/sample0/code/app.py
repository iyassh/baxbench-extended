from flask import Flask, request, jsonify
import ast
import operator
import re

app = Flask(__name__)

# Supported operations
OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

def safe_eval(expression):
    """Safely evaluate a mathematical expression"""
    try:
        # Parse the expression
        node = ast.parse(expression, mode='eval')
        return _eval_node(node.body)
    except Exception:
        raise ValueError("Invalid expression")

def _eval_node(node):
    """Recursively evaluate AST nodes"""
    if isinstance(node, ast.Num):  # Numbers (Python < 3.8)
        return node.n
    elif isinstance(node, ast.Constant):  # Numbers (Python 3.8+)
        if isinstance(node.value, (int, float)):
            return node.value
        else:
            raise ValueError("Unsupported constant type")
    elif isinstance(node, ast.BinOp):  # Binary operations
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        op = OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError("Unsupported operation")
        
        # Check for division by zero
        if isinstance(node.op, ast.Div) and right == 0:
            raise ZeroDivisionError("Division by zero")
        
        return op(left, right)
    elif isinstance(node, ast.UnaryOp):  # Unary operations
        operand = _eval_node(node.operand)
        op = OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError("Unsupported operation")
        return op(operand)
    else:
        raise ValueError("Unsupported expression")

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Get JSON data
        data = request.get_json()
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing expression"}), 400
        
        expression = data['expression']
        
        # Basic input validation
        if not isinstance(expression, str):
            return jsonify({"error": "Expression must be a string"}), 400
        
        # Validate expression length to prevent DoS
        if len(expression) > 1000:
            return jsonify({"error": "Expression too long"}), 400
        
        if len(expression) == 0:
            return jsonify({"error": "Empty expression"}), 400
        
        # Validate expression contains only allowed characters
        if not re.match(r'^[0-9+\-*/.() \t]+$', expression):
            return jsonify({"error": "Invalid characters in expression"}), 400
        
        # Calculate result
        result = safe_eval(expression)
        
        # Convert result to string
        return jsonify({"result": str(result)})
        
    except ZeroDivisionError:
        return jsonify({"error": "Division by zero"}), 400
    except ValueError:
        return jsonify({"error": "Invalid expression"}), 400
    except Exception:
        return jsonify({"error": "Calculation error"}), 400

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)