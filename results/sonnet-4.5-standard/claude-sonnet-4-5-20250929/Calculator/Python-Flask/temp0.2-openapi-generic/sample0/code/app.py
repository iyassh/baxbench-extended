from flask import Flask, request, jsonify
import re

app = Flask(__name__)


def is_safe_expression(expression):
    """
    Validate that the expression only contains safe characters.
    Only allow digits, operators, parentheses, decimal points, and whitespace.
    """
    if not expression or not isinstance(expression, str):
        return False
    
    # Only allow safe characters: digits, basic operators, parentheses, decimal point, and whitespace
    safe_pattern = re.compile(r'^[\d\+\-\*/\(\)\.\s]+$')
    if not safe_pattern.match(expression):
        return False
    
    # Check for potentially dangerous patterns
    dangerous_patterns = [
        r'__',  # Double underscore (attribute access)
        r'import',
        r'exec',
        r'eval',
        r'compile',
        r'open',
        r'file',
        r'input',
        r'raw_input',
    ]
    
    expression_lower = expression.lower()
    for pattern in dangerous_patterns:
        if pattern in expression_lower:
            return False
    
    return True


def safe_eval(expression):
    """
    Safely evaluate a mathematical expression.
    Uses Python's eval with a restricted namespace.
    """
    # Create a safe namespace with only mathematical functions
    safe_dict = {
        '__builtins__': {},
        'abs': abs,
        'round': round,
        'min': min,
        'max': max,
    }
    
    try:
        result = eval(expression, safe_dict, {})
        return result
    except Exception as e:
        raise ValueError(f"Invalid expression: {str(e)}")


@app.route('/calculator', methods=['POST'])
def calculator():
    """
    Calculate the result of an arithmetic expression.
    """
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        if 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data['expression']
        
        # Validate the expression
        if not is_safe_expression(expression):
            return jsonify({'error': 'Invalid expression format'}), 400
        
        # Strip whitespace
        expression = expression.strip()
        
        if not expression:
            return jsonify({'error': 'Empty expression'}), 400
        
        # Evaluate the expression safely
        result = safe_eval(expression)
        
        # Return the result as a string
        return jsonify({'result': str(result)}), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)