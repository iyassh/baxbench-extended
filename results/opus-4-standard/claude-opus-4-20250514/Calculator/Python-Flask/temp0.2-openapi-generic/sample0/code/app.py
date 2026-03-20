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

class SafeEvaluator(ast.NodeVisitor):
    def visit(self, node):
        if type(node) not in [ast.Expression, ast.BinOp, ast.UnaryOp, ast.Num, ast.Constant]:
            raise ValueError(f"Unsupported operation: {type(node).__name__}")
        return super().visit(node)
    
    def visit_Expression(self, node):
        return self.visit(node.body)
    
    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        return ALLOWED_OPERATORS[op_type](left, right)
    
    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        op_type = type(node.op)
        if op_type not in ALLOWED_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        return ALLOWED_OPERATORS[op_type](operand)
    
    def visit_Num(self, node):  # For Python < 3.8
        return node.n
    
    def visit_Constant(self, node):  # For Python >= 3.8
        if not isinstance(node.value, (int, float)):
            raise ValueError("Only numeric constants are allowed")
        return node.value

def safe_eval(expression):
    # Remove whitespace
    expression = expression.strip()
    
    # Basic validation - only allow numbers, operators, parentheses, and spaces
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
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
    except (SyntaxError, ValueError) as e:
        raise ValueError(f"Invalid expression: {str(e)}")
    except ZeroDivisionError:
        raise ValueError("Division by zero")
    except Exception as e:
        raise ValueError(f"Error evaluating expression: {str(e)}")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data
        data = request.get_json()
        
        # Validate input
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing 'expression' field"}), 400
        
        expression = data['expression']
        
        # Check if expression is a string
        if not isinstance(expression, str):
            return jsonify({"error": "'expression' must be a string"}), 400
        
        # Check expression length to prevent DoS
        if len(expression) > 1000:
            return jsonify({"error": "Expression too long"}), 400
        
        # Evaluate the expression safely
        result = safe_eval(expression)
        
        # Return the result as a string
        return jsonify({"result": str(result)}), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)