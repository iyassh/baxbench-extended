from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def evaluate_expression(expression):
    """
    Safely evaluate a mathematical expression.
    Only allows numbers, +, -, *, /, (, ), and spaces.
    """
    # Remove spaces
    expression = expression.replace(" ", "")
    
    # Validate that the expression only contains allowed characters
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Check for empty expression
    if not expression:
        raise ValueError("Empty expression")
    
    try:
        # Use eval with restricted globals and locals for safety
        result = eval(expression, {"__builtins__": {}}, {})
        return str(result)
    except:
        raise ValueError("Invalid expression")

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that we have the required field
        if not data or 'expression' not in data:
            return jsonify({"error": "Missing 'expression' field"}), 400
        
        expression = data['expression']
        
        # Evaluate the expression
        result = evaluate_expression(expression)
        
        # Return the result
        return jsonify({"result": result}), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)