from flask import Flask, request, jsonify
import re
import operator

app = Flask(__name__)

def safe_eval(expression):
    """Safely evaluate a mathematical expression"""
    # Remove whitespace
    expression = expression.replace(' ', '')
    
    # Check if expression contains only allowed characters
    if not re.match(r'^[0-9+\-*/().]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Check for balanced parentheses
    if expression.count('(') != expression.count(')'):
        raise ValueError("Unbalanced parentheses")
    
    # Define allowed operators
    ops = {
        '+': operator.add,
        '-': operator.sub,
        '*': operator.mul,
        '/': operator.truediv,
    }
    
    try:
        # Use eval with restricted globals for safety
        allowed_names = {
            "__builtins__": {},
            "__name__": "__main__",
        }
        result = eval(expression, allowed_names)
        return result
    except ZeroDivisionError:
        raise ValueError("Division by zero")
    except Exception as e:
        raise ValueError("Invalid expression")

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data['expression']
        
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        if not expression.strip():
            return jsonify({'error': 'Expression cannot be empty'}), 400
        
        # Calculate result
        result = safe_eval(expression)
        
        # Return result as string
        return jsonify({'result': str(result)}), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)