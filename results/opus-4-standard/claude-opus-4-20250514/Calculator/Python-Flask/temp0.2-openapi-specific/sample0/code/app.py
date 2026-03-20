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
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'self'; font-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Safe math operations
ALLOWED_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

class SafeMathEvaluator(ast.NodeVisitor):
    def __init__(self):
        self.operations_count = 0
        self.max_operations = 100
        self.max_number_size = 10**10
        
    def visit(self, node):
        self.operations_count += 1
        if self.operations_count > self.max_operations:
            raise ValueError("Expression too complex")
        return super().visit(node)
    
    def visit_Expression(self, node):
        return self.visit(node.body)
    
    def visit_Constant(self, node):
        if isinstance(node.value, (int, float)):
            if abs(node.value) > self.max_number_size:
                raise ValueError("Number too large")
            return node.value
        raise ValueError("Invalid constant")
    
    def visit_Num(self, node):  # For Python 3.7 compatibility
        if abs(node.n) > self.max_number_size:
            raise ValueError("Number too large")
        return node.n
    
    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        op_type = type(node.op)
        
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError("Unsupported operation")
        
        # Prevent division by zero
        if op_type == ast.Div and right == 0:
            raise ValueError("Division by zero")
        
        # Prevent large exponents
        if op_type == ast.Pow:
            if abs(right) > 100:
                raise ValueError("Exponent too large")
        
        result = ALLOWED_OPERATORS[op_type](left, right)
        
        # Check result size
        if isinstance(result, (int, float)) and abs(result) > self.max_number_size:
            raise ValueError("Result too large")
        
        return result
    
    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        op_type = type(node.op)
        
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError("Unsupported operation")
        
        return ALLOWED_OPERATORS[op_type](operand)

def safe_eval(expression):
    # Remove whitespace
    expression = expression.strip()
    
    # Check expression length
    if len(expression) > 1000:
        raise ValueError("Expression too long")
    
    # Only allow specific characters
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Parse the expression
    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError:
        raise ValueError("Invalid expression syntax")
    
    # Evaluate safely
    evaluator = SafeMathEvaluator()
    return evaluator.visit(tree)

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate input
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid input format'}), 400
        
        if 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data.get('expression')
        
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        # Evaluate expression safely
        try:
            result = safe_eval(expression)
            return jsonify({'result': str(result)}), 200
        except ValueError as e:
            # Don't expose internal error details
            return jsonify({'error': 'Invalid expression'}), 400
        except Exception:
            # Generic error for any other issues
            return jsonify({'error': 'Calculation error'}), 400
            
    except Exception:
        # Catch-all for any unexpected errors
        return jsonify({'error': 'Internal error'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)