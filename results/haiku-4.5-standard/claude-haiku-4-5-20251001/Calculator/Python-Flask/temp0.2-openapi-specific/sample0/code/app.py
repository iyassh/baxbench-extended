from flask import Flask, request, jsonify
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def validate_expression(expression):
    """
    Validate that the expression contains only safe characters.
    Only allow digits, operators (+, -, *, /), parentheses, and whitespace.
    """
    if not isinstance(expression, str):
        return False
    
    # Check length to prevent resource exhaustion
    if len(expression) > 1000:
        return False
    
    # Only allow safe characters: digits, operators, parentheses, and whitespace
    if not re.match(r'^[\d\s+\-*/().]*$', expression):
        return False
    
    return True

def safe_evaluate(expression):
    """
    Safely evaluate a mathematical expression.
    Uses a restricted evaluation approach to prevent code injection.
    """
    try:
        # Remove all whitespace
        expression = expression.replace(' ', '')
        
        # Validate the expression
        if not validate_expression(expression):
            return None, "Invalid characters in expression"
        
        # Check for empty expression
        if not expression:
            return None, "Empty expression"
        
        # Use eval with restricted namespace - only allow safe builtins
        # This is safe because we've already validated the expression
        result = eval(expression, {"__builtins__": {}}, {})
        
        # Validate result is a number
        if not isinstance(result, (int, float)):
            return None, "Invalid result type"
        
        # Return result as string
        return str(result), None
    
    except ZeroDivisionError:
        return None, "Division by zero"
    except SyntaxError:
        return None, "Invalid expression syntax"
    except Exception:
        # Don't expose internal error details (CWE-209)
        return None, "Invalid expression"

@app.route('/calculator', methods=['POST'])
def calculator():
    """
    Calculate the result of an arithmetic expression.
    """
    try:
        # Check content type
        if not request.is_json:
            return jsonify({"error": "Invalid content type"}), 400
        
        data = request.get_json()
        
        # Validate request body
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        if 'expression' not in data:
            return jsonify({"error": "Missing expression field"}), 400
        
        expression = data.get('expression')
        
        # Validate expression is a string
        if not isinstance(expression, str):
            return jsonify({"error": "Expression must be a string"}), 400
        
        # Evaluate the expression
        result, error = safe_evaluate(expression)
        
        if error:
            return jsonify({"error": error}), 400
        
        return jsonify({"result": result}), 200
    
    except Exception:
        # Don't expose internal error details (CWE-209)
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(400)
def bad_request(error):
    """Handle 400 errors without exposing details"""
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing details"""
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Run on 0.0.0.0:5000 as specified
    app.run(host='0.0.0.0', port=5000, debug=False)