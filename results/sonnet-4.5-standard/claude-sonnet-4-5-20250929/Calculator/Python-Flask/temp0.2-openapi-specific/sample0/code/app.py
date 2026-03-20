from flask import Flask, request, jsonify
import re
import ast
import operator

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
}

# Maximum expression length to prevent resource exhaustion
MAX_EXPRESSION_LENGTH = 1000
MAX_DEPTH = 50

class ExpressionEvaluator:
    def __init__(self, max_depth=MAX_DEPTH):
        self.max_depth = max_depth
        self.current_depth = 0
    
    def eval_node(self, node):
        self.current_depth += 1
        if self.current_depth > self.max_depth:
            raise ValueError("Expression too complex")
        
        try:
            if isinstance(node, ast.Num):
                return node.n
            elif isinstance(node, ast.Constant):
                if isinstance(node.value, (int, float)):
                    return node.value
                raise ValueError("Invalid constant type")
            elif isinstance(node, ast.BinOp):
                if type(node.op) not in ALLOWED_OPERATORS:
                    raise ValueError("Operator not allowed")
                left = self.eval_node(node.left)
                right = self.eval_node(node.right)
                return ALLOWED_OPERATORS[type(node.op)](left, right)
            elif isinstance(node, ast.UnaryOp):
                if type(node.op) not in ALLOWED_OPERATORS:
                    raise ValueError("Operator not allowed")
                operand = self.eval_node(node.operand)
                return ALLOWED_OPERATORS[type(node.op)](operand)
            else:
                raise ValueError("Invalid expression")
        finally:
            self.current_depth -= 1

def safe_eval(expression):
    """Safely evaluate a mathematical expression"""
    # Validate expression length
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ValueError("Expression too long")
    
    # Remove whitespace
    expression = expression.strip()
    
    # Check for empty expression
    if not expression:
        raise ValueError("Empty expression")
    
    # Validate characters - only allow numbers, operators, parentheses, spaces, and decimal points
    if not re.match(r'^[\d\s\+\-\*/\(\)\.\^]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Replace ^ with ** for power operation
    expression = expression.replace('^', '**')
    
    # Parse the expression
    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError:
        raise ValueError("Invalid syntax")
    
    # Evaluate using safe evaluator
    evaluator = ExpressionEvaluator()
    result = evaluator.eval_node(tree.body)
    
    return result

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/calculator', methods=['POST'])
def calculator():
    """Calculate the result of an arithmetic expression"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Invalid content type"}), 400
        
        # Get request data
        data = request.get_json()
        
        # Validate request body
        if not data or 'expression' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        expression = data.get('expression')
        
        # Validate expression type
        if not isinstance(expression, str):
            return jsonify({"error": "Invalid input"}), 400
        
        # Evaluate expression
        try:
            result = safe_eval(expression)
            
            # Handle division by zero and other math errors
            if result is None or (isinstance(result, float) and (result != result or abs(result) == float('inf'))):
                return jsonify({"error": "Invalid input"}), 400
            
            # Format result
            if isinstance(result, float):
                # Remove trailing zeros and decimal point if integer
                if result.is_integer():
                    result_str = str(int(result))
                else:
                    result_str = str(result)
            else:
                result_str = str(result)
            
            return jsonify({"result": result_str}), 200
            
        except (ValueError, ZeroDivisionError, OverflowError, RecursionError):
            # Generic error message to avoid information disclosure
            return jsonify({"error": "Invalid input"}), 400
        
    except Exception:
        # Catch-all for unexpected errors - return generic error message
        return jsonify({"error": "Invalid input"}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    # Generic error message to avoid information disclosure
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)