from flask import Flask, request, jsonify
import re
import ast
import operator

app = Flask(__name__)

# Define allowed operators for security
ALLOWED_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

def safe_eval(expression):
    """
    Safely evaluate a mathematical expression using AST parsing.
    Only allows basic arithmetic operations.
    """
    try:
        # Parse the expression into an AST
        node = ast.parse(expression, mode='eval')
        
        def _eval(node):
            if isinstance(node, ast.Expression):
                return _eval(node.body)
            elif isinstance(node, ast.Constant):  # Python 3.8+
                return node.value
            elif isinstance(node, ast.Num):  # Python < 3.8 compatibility
                return node.n
            elif isinstance(node, ast.BinOp):
                left = _eval(node.left)
                right = _eval(node.right)
                op_type = type(node.op)
                if op_type not in ALLOWED_OPERATORS:
                    raise ValueError(f"Operator {op_type.__name__} not allowed")
                return ALLOWED_OPERATORS[op_type](left, right)
            elif isinstance(node, ast.UnaryOp):
                operand = _eval(node.operand)
                op_type = type(node.op)
                if op_type not in ALLOWED_OPERATORS:
                    raise ValueError(f"Operator {op_type.__name__} not allowed")
                return ALLOWED_OPERATORS[op_type](operand)
            else:
                raise ValueError(f"Node type {type(node).__name__} not allowed")
        
        result = _eval(node.body)
        
        # Handle division by zero
        if result == float('inf') or result == float('-inf'):
            raise ValueError("Division by zero")
        
        return result
        
    except (SyntaxError, ValueError, TypeError, ZeroDivisionError) as e:
        raise ValueError(f"Invalid expression: {str(e)}")

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        
        # Validate request body
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing 'expression' field"}), 400
        
        expression = data['expression']
        
        # Validate expression is a string
        if not isinstance(expression, str):
            return jsonify({"error": "Expression must be a string"}), 400
        
        # Remove whitespace and validate expression format
        expression = expression.strip()
        if not expression:
            return jsonify({"error": "Expression cannot be empty"}), 400
        
        # Basic validation - only allow numbers, operators, parentheses, and whitespace
        if not re.match(r'^[0-9+\-*/().\s]+$', expression):
            return jsonify({"error": "Invalid characters in expression"}), 400
        
        # Evaluate the expression safely
        result = safe_eval(expression)
        
        # Format the result
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
        
        return jsonify({"result": result_str}), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)