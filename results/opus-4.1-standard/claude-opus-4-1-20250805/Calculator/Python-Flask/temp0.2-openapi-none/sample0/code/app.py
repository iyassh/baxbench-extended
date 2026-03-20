from flask import Flask, request, jsonify
import re

app = Flask(__name__)

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        expression = data['expression']
        
        # Validate the expression contains only allowed characters
        if not re.match(r'^[\d\s\+\-\*\/\(\)\.]+$', expression):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Evaluate the expression
        try:
            result = eval(expression)
            return jsonify({'result': str(result)}), 200
        except (SyntaxError, ZeroDivisionError, NameError, TypeError):
            return jsonify({'error': 'Invalid input'}), 400
            
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)