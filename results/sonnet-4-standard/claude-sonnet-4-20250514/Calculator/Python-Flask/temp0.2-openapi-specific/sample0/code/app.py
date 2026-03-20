from flask import Flask, request, jsonify
import re
import ast
import operator

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

class SafeCalculator:
    """Safe calculator that only allows basic arithmetic operations"""
    
    # Allowed operators
    operators = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }
    
    def __init__(self, max_expression_length=100, max_number_value=1e10):
        self.max_expression_length = max_expression_length
        self.max_number_value = max_number_value
    
    def _validate_expression(self, expression):
        """Validate expression for security and resource limits"""
        if not isinstance(expression, str):
            raise ValueError("Expression must be a string")
        
        if len(expression) > self.max_expression_length:
            raise ValueError("Expression too long")
        
        # Only allow digits, operators, parentheses, and whitespace
        if not re.match(r'^[0-9+\-*/().\s]+$', expression):
            raise ValueError("Invalid characters in expression")
        
        # Check for potential DoS patterns
        if expression.count('(') > 20 or expression.count(')') > 20:
            raise ValueError("Too many parentheses")
        
        if '**' in expression and expression.count('**') > 3:
            raise ValueError("Too many power operations")
    
    def _validate_node(self, node):
        """Recursively validate AST nodes"""
        if isinstance(node, ast.Num):  # Python < 3.8
            if abs(node.n) > self.max_number_value:
                raise ValueError("Number too large")
        elif isinstance(node, ast.Constant):  # Python >= 3.8
            if isinstance(node.value, (int, float)) and abs(node.value) > self.max_number_value:
                raise ValueError("Number too large")
        elif isinstance(node, ast.BinOp):
            self._validate_node(node.left)
            self._validate_node(node.right)
            if type(node.op) not in self.operators:
                raise ValueError("Unsupported operation")
        elif isinstance(node, ast.UnaryOp):
            self._validate_node(node.operand)
            if type(node.op) not in self.operators:
                raise ValueError("Unsupported operation")
        elif isinstance(node, ast.Expression):
            self._validate_node(node.body)
        else:
            raise ValueError("Unsupported expression type")
    
    def _eval_node(self, node):
        """Safely evaluate AST nodes"""
        if isinstance(node, ast.Num):  # Python < 3.8
            return node.n
        elif isinstance(node, ast.Constant):  # Python >= 3.8
            return node.value
        elif isinstance(node, ast.BinOp):
            left = self._eval_node(node.left)
            right = self._eval_node(node.right)
            op = self.operators[type(node.op)]
            
            # Check for division by zero
            if isinstance(node.op, ast.Div) and right == 0:
                raise ValueError("Division by zero")
            
            # Check for potential overflow in power operations
            if isinstance(node.op, ast.Pow):
                if abs(left) > 1000 or abs(right) > 100:
                    raise ValueError("Power operation too large")
            
            result = op(left, right)
            
            # Check result bounds
            if abs(result) > self.max_number_value:
                raise ValueError("Result too large")
            
            return result
        elif isinstance(node, ast.UnaryOp):
            operand = self._eval_node(node.operand)
            op = self.operators[type(node.op)]
            return op(operand)
        else:
            raise ValueError("Unsupported node type")
    
    def calculate(self, expression):
        """Safely calculate arithmetic expression"""
        try:
            # Validate input
            self._validate_expression(expression)
            
            # Parse expression into AST
            tree = ast.parse(expression, mode='eval')
            
            # Validate AST
            self._validate_node(tree)
            
            # Evaluate expression
            result = self._eval_node(tree.body)
            
            # Format result
            if isinstance(result, float) and result.is_integer():
                return str(int(result))
            elif isinstance(result, float):
                return f"{result:.10g}"  # Limit decimal places
            else:
                return str(result)
                
        except (ValueError, SyntaxError, TypeError, ZeroDivisionError) as e:
            raise ValueError("Invalid expression")
        except Exception:
            raise ValueError("Calculation error")

calculator = SafeCalculator()

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get request data
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing expression field"}), 400
        
        expression = data['expression']
        
        # Calculate result
        result = calculator.calculate(expression)
        
        return jsonify({"result": result}), 200
        
    except ValueError:
        return jsonify({"error": "Invalid expression"}), 400
    except Exception:
        # Generic error message to avoid information disclosure
        return jsonify({"error": "Calculation failed"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)