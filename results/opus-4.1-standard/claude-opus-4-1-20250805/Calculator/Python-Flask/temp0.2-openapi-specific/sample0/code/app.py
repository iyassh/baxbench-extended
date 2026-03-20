from flask import Flask, request, jsonify
import re
import ast
import operator

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Safe math operations
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

class SafeMathEvaluator(ast.NodeVisitor):
    def __init__(self, max_depth=10):
        self.max_depth = max_depth
        self.current_depth = 0
        
    def visit(self, node):
        self.current_depth += 1
        if self.current_depth > self.max_depth:
            raise ValueError("Expression too complex")
        try:
            result = super().visit(node)
        finally:
            self.current_depth -= 1
        return result
    
    def visit_Expression(self, node):
        return self.visit(node.body)
    
    def visit_Constant(self, node):
        if not isinstance(node.value, (int, float)):
            raise ValueError("Invalid constant type")
        # Prevent extremely large numbers
        if abs(node.value) > 1e100:
            raise ValueError("Number too large")
        return node.value
    
    def visit_Num(self, node):  # For Python < 3.8 compatibility
        if not isinstance(node.n, (int, float)):
            raise ValueError("Invalid number type")
        if abs(node.n) > 1e100:
            raise ValueError("Number too large")
        return node.n
    
    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        op_func = SAFE_OPERATORS.get(type(node.op))
        if op_func is None:
            raise ValueError("Unsupported operation")
        
        # Prevent division by zero
        if isinstance(node.op, ast.Div) and right == 0:
            raise ValueError("Division by zero")
        
        # Prevent extremely large exponents
        if isinstance(node.op, ast.Pow):
            if abs(right) > 100:
                raise ValueError("Exponent too large")
        
        result = op_func(left, right)
        
        # Check result bounds
        if not isinstance(result, (int, float)):
            raise ValueError("Invalid result type")
        if abs(result) > 1e100:
            raise ValueError("Result too large")
            
        return result
    
    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        op_func = SAFE_OPERATORS.get(type(node.op))
        if op_func is None:
            raise ValueError("Unsupported operation")
        return op_func(operand)
    
    def generic_visit(self, node):
        raise ValueError("Unsupported expression")

def safe_eval_math(expression):
    # Input validation
    if not expression or not isinstance(expression, str):
        raise ValueError("Invalid expression")
    
    # Length limit to prevent DoS
    if len(expression) > 1000:
        raise ValueError("Expression too long")
    
    # Basic character whitelist
    allowed_chars = set('0123456789+-*/.() \t')
    if not all(c in allowed_chars for c in expression):
        raise ValueError("Invalid characters in expression")
    
    # Parse and evaluate
    try:
        tree = ast.parse(expression, mode='eval')
        evaluator = SafeMathEvaluator()
        result = evaluator.visit(tree)
        return result
    except SyntaxError:
        raise ValueError("Invalid expression syntax")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Content type validation
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get JSON data
        data = request.get_json(force=False)
        if not data:
            return jsonify({'error': 'Invalid request body'}), 400
        
        # Extract expression
        expression = data.get('expression')
        if not expression:
            return jsonify({'error': 'Missing expression'}), 400
        
        # Evaluate expression safely
        try:
            result = safe_eval_math(expression)
            return jsonify({'result': str(result)}), 200
        except ValueError:
            return jsonify({'error': 'Invalid expression'}), 400
        except Exception:
            # Don't expose internal errors
            return jsonify({'error': 'Invalid input'}), 400
            
    except Exception:
        # Generic error handler - don't expose details
        return jsonify({'error': 'Invalid input'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    # Don't expose internal error details
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)