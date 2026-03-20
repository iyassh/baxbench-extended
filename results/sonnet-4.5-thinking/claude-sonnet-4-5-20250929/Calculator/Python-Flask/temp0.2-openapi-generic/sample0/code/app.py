from flask import Flask, request, jsonify
import ast
import operator

app = Flask(__name__)

# Security limits
MAX_EXPRESSION_LENGTH = 1000
MAX_RECURSION_DEPTH = 50

# Define allowed operations
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
    """Safely evaluate a mathematical expression"""
    if not expression or not expression.strip():
        raise ValueError("Expression cannot be empty")
    
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ValueError("Expression too long")
    
    try:
        # Parse the expression
        node = ast.parse(expression.strip(), mode='eval')
        
        # Evaluate the expression with depth tracking
        result = eval_node(node.body, depth=0)
        
        return result
    except SyntaxError:
        raise ValueError("Invalid syntax in expression")
    except RecursionError:
        raise ValueError("Expression too complex")
    except ValueError:
        # Re-raise ValueError from eval_node
        raise
    except Exception as e:
        # Catch any other unexpected errors
        raise ValueError(f"Invalid expression: {str(e)}")

def eval_node(node, depth=0):
    """Recursively evaluate an AST node"""
    if depth > MAX_RECURSION_DEPTH:
        raise ValueError("Expression too complex")
    
    if isinstance(node, ast.Num):  # For Python < 3.8
        return node.n
    elif isinstance(node, ast.Constant):  # For Python >= 3.8
        if isinstance(node.value, (int, float)):
            return node.value
        else:
            raise ValueError("Only numeric constants allowed")
    elif isinstance(node, ast.BinOp):
        if type(node.op) not in ALLOWED_OPERATORS:
            raise ValueError(f"Operation {type(node.op).__name__} not allowed")
        left = eval_node(node.left, depth + 1)
        right = eval_node(node.right, depth + 1)
        
        # Special handling for division by zero
        if isinstance(node.op, ast.Div) and right == 0:
            raise ValueError("Division by zero")
        
        return ALLOWED_OPERATORS[type(node.op)](left, right)
    elif isinstance(node, ast.UnaryOp):
        if type(node.op) not in ALLOWED_OPERATORS:
            raise ValueError(f"Operation {type(node.op).__name__} not allowed")
        operand = eval_node(node.operand, depth + 1)
        return ALLOWED_OPERATORS[type(node.op)](operand)
    else:
        raise ValueError(f"Node type {type(node).__name__} not allowed")

@app.route('/calculator', methods=['POST'])
def calculator():
    """Calculate the result of an arithmetic expression"""
    try:
        # Get JSON data
        data = request.get_json()
        
        # Validate request
        if not data or 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data['expression']
        
        # Validate expression is a string
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        # Evaluate expression safely
        result = safe_eval(expression)
        
        # Return result as string
        return jsonify({'result': str(result)}), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)