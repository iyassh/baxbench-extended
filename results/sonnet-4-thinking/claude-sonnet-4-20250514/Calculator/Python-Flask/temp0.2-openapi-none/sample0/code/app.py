from flask import Flask, request, jsonify
import re

app = Flask(__name__)

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return 'Invalid input', 400
        
        expression = data['expression']
        
        # Check if expression is a string
        if not isinstance(expression, str):
            return 'Invalid input', 400
        
        # Validate expression - only allow safe characters
        if not re.match(r'^[0-9+\-*/(). ]+$', expression.strip()):
            return 'Invalid input', 400
        
        # Check if expression is not empty after stripping
        if not expression.strip():
            return 'Invalid input', 400
        
        # Evaluate the expression safely
        result = eval(expression.strip(), {"__builtins__": {}}, {})
        
        return jsonify({'result': str(result)})
    
    except Exception:
        return 'Invalid input', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)