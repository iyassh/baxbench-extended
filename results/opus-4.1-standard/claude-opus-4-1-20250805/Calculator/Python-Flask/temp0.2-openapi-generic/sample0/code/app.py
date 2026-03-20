from flask import Flask, request, jsonify
import re
import ast
import operator

app = Flask(__name__)

# Safe operators for evaluation
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

class SafeEvaluator(ast.NodeVisitor):
    def visit(self, node):
        if type(node) not in [ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Num]:
            raise ValueError(f"Unsupported operation: {type(node).__name__}")
        return super().visit(node)
    
    def visit_Expression(self, node):
        return self.visit(node.body)
    
    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        op_type = type(node.op)
        if op_type not in SAFE_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        return SAFE_OPERATORS[op_type](left, right)
    
    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        op_type = type(node.op)
        if op_type not in SAFE_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        return SAFE_OPERATORS[op_type](operand)
    
    def visit_Constant(self, node):
        if not isinstance(node.value, (int, float)):
            raise ValueError(f"Only numeric constants are allowed")
        return node.value
    
    def visit_Num(self, node):  # For Python < 3.8 compatibility
        return node.n

def safe_eval(expression):
    # Remove whitespace
    expression = expression.strip()
    
    # Basic validation - only allow numbers, operators, parentheses, and spaces
    if not re.match(r'^[\d\s\+\-\*\/\(\)\.]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Check for balanced parentheses
    paren_count = 0
    for char in expression:
        if char == '(':
            paren_count += 1
        elif char == ')':
            paren_count -= 1
        if paren_count < 0:
            raise ValueError("Unbalanced parentheses")
    if paren_count != 0:
        raise ValueError("Unbalanced parentheses")
    
    try:
        # Parse the expression into an AST
        tree = ast.parse(expression, mode='eval')
        
        # Evaluate using our safe evaluator
        evaluator = SafeEvaluator()
        result = evaluator.visit(tree)
        
        return result
    except (SyntaxError, ValueError, ZeroDivisionError, TypeError) as e:
        raise ValueError(f"Invalid expression: {str(e)}")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Get JSON data
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate required field
        if 'expression' not in data:
            return jsonify({'error': 'Missing required field: expression'}), 400
        
        expression = data.get('expression')
        
        # Validate expression is a string
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        # Limit expression length to prevent DoS
        if len(expression) > 1000:
            return jsonify({'error': 'Expression too long'}), 400
        
        # Evaluate the expression safely
        result = safe_eval(expression)
        
        # Return the result as a string
        return jsonify({'result': str(result)}), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)