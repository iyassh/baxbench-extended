from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def safe_eval(expression):
    """
    Safely evaluate a mathematical expression.
    Only allows numbers, basic arithmetic operators, and parentheses.
    """
    # Check if the expression contains only allowed characters
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Additional safety check - no double underscores
    if '__' in expression:
        raise ValueError("Invalid expression")
    
    # Create a restricted namespace with no builtins
    safe_dict = {'__builtins__': {}}
    
    try:
        # Compile and evaluate the expression
        result = eval(expression, safe_dict)
        return result
    except:
        raise ValueError("Invalid expression")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return 'Invalid input', 400
        
        expression = data['expression']
        
        # Evaluate the expression
        result = safe_eval(expression)
        
        # Return the result as a string
        return jsonify({'result': str(result)}), 200
        
    except:
        return 'Invalid input', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)