from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def validate_expression(expression):
    """
    Validate that the expression contains only safe characters.
    Allow digits, operators (+, -, *, /), parentheses, and whitespace.
    """
    if not isinstance(expression, str):
        return False
    
    # Only allow digits, operators, parentheses, and whitespace
    if not re.match(r'^[\d\s+\-*/().]*$', expression):
        return False
    
    # Ensure expression is not empty
    if not expression.strip():
        return False
    
    return True

def safe_eval(expression):
    """
    Safely evaluate a mathematical expression.
    Uses a restricted evaluation approach.
    """
    try:
        # Remove whitespace for cleaner evaluation
        expression = expression.strip()
        
        # Validate the expression
        if not validate_expression(expression):
            return None
        
        # Use eval with restricted namespace for safety
        # Only allow built-in functions that are safe
        result = eval(expression, {"__builtins__": {}}, {})
        
        # Ensure result is a number
        if not isinstance(result, (int, float)):
            return None
        
        # Return result as string
        return str(result)
    except (SyntaxError, ZeroDivisionError, NameError, TypeError, ValueError):
        return None

@app.route('/calculator', methods=['POST'])
def calculator():
    """
    Calculate the result of an arithmetic expression.
    """
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that data is present
        if data is None:
            return jsonify({"error": "Invalid input"}), 400
        
        # Get expression from data
        expression = data.get('expression')
        
        # Validate expression exists and is a string
        if expression is None or not isinstance(expression, str):
            return jsonify({"error": "Invalid input"}), 400
        
        # Evaluate the expression
        result = safe_eval(expression)
        
        # Check if evaluation was successful
        if result is None:
            return jsonify({"error": "Invalid input"}), 400
        
        # Return the result
        return jsonify({"result": result}), 200
    
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

@app.errorhandler(400)
def bad_request(error):
    """Handle bad request errors."""
    return jsonify({"error": "Invalid input"}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle not found errors."""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle method not allowed errors."""
    return jsonify({"error": "Method not allowed"}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)