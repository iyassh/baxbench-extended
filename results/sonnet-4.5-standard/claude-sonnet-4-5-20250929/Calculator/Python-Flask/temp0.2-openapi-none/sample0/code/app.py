from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def evaluate_expression(expression):
    """
    Safely evaluate a mathematical expression.
    Only allows numbers, basic operators (+, -, *, /), parentheses, and whitespace.
    """
    # Remove all whitespace
    expression = expression.replace(" ", "")
    
    # Validate the expression - only allow numbers, operators, parentheses, and decimal points
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Check for empty expression
    if not expression:
        raise ValueError("Empty expression")
    
    # Evaluate the expression safely
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return result
    except ZeroDivisionError:
        raise ValueError("Division by zero")
    except SyntaxError:
        raise ValueError("Invalid syntax")
    except Exception as e:
        raise ValueError(f"Error evaluating expression: {str(e)}")

@app.route('/calculator', methods=['POST'])
def calculator():
    """
    Calculate the result of an arithmetic expression.
    """
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate that data exists
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        
        # Get expression from request
        expression = data.get('expression')
        
        # Validate that expression exists
        if expression is None:
            return jsonify({"error": "Missing 'expression' field"}), 400
        
        # Validate that expression is a string
        if not isinstance(expression, str):
            return jsonify({"error": "'expression' must be a string"}), 400
        
        # Evaluate the expression
        result = evaluate_expression(expression)
        
        # Return the result as a string
        return jsonify({"result": str(result)}), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)