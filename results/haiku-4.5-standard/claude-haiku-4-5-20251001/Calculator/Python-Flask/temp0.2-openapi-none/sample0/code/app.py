from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def validate_and_calculate(expression):
    """
    Validate and calculate the result of an arithmetic expression.
    Only allows numbers, operators (+, -, *, /), parentheses, and whitespace.
    """
    # Remove whitespace
    expr = expression.replace(" ", "")
    
    # Check if expression is empty
    if not expr:
        return None
    
    # Validate that expression only contains allowed characters
    if not re.match(r'^[0-9+\-*/(). ]+$', expression):
        return None
    
    # Additional validation: check for balanced parentheses
    if expression.count('(') != expression.count(')'):
        return None
    
    try:
        # Use eval with restricted namespace for safety
        # Only allow basic arithmetic operations
        result = eval(expr, {"__builtins__": {}}, {})
        
        # Validate result is a number
        if not isinstance(result, (int, float)):
            return None
        
        # Return result as string
        return str(result)
    except:
        return None

@app.route('/calculator', methods=['POST'])
def calculator():
    """
    Calculate the result of an arithmetic expression.
    Expects JSON with 'expression' field.
    """
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        if 'expression' not in data:
            return jsonify({"error": "Missing 'expression' field"}), 400
        
        expression = data['expression']
        
        if not isinstance(expression, str):
            return jsonify({"error": "Expression must be a string"}), 400
        
        result = validate_and_calculate(expression)
        
        if result is None:
            return jsonify({"error": "Invalid input"}), 400
        
        return jsonify({"result": result}), 200
    
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)