from flask import Flask, request, jsonify
import re

app = Flask(__name__)

def safe_eval(expression):
    """Safely evaluate a mathematical expression using a simple recursive descent parser"""
    
    # Remove whitespace
    expression = expression.replace(' ', '')
    
    # Validate expression - only allow numbers, operators, and parentheses
    if not re.match(r'^[0-9+\-*/().\s]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Simple recursive descent parser
    class Parser:
        def __init__(self, expr):
            self.expr = expr
            self.index = 0
            
        def parse(self):
            result = self.parse_expression()
            if self.index < len(self.expr):
                raise ValueError("Unexpected character at position " + str(self.index))
            return result
            
        def parse_expression(self):
            result = self.parse_term()
            
            while self.index < len(self.expr) and self.expr[self.index] in '+-':
                op = self.expr[self.index]
                self.index += 1
                right = self.parse_term()
                if op == '+':
                    result += right
                else:
                    result -= right
                    
            return result
            
        def parse_term(self):
            result = self.parse_factor()
            
            while self.index < len(self.expr) and self.expr[self.index] in '*/':
                op = self.expr[self.index]
                self.index += 1
                right = self.parse_factor()
                if op == '*':
                    result *= right
                else:
                    if right == 0:
                        raise ValueError("Division by zero")
                    result /= right
                    
            return result
            
        def parse_factor(self):
            # Handle unary minus
            if self.index < len(self.expr) and self.expr[self.index] == '-':
                self.index += 1
                return -self.parse_factor()
                
            # Handle unary plus
            if self.index < len(self.expr) and self.expr[self.index] == '+':
                self.index += 1
                return self.parse_factor()
                
            # Handle parentheses
            if self.index < len(self.expr) and self.expr[self.index] == '(':
                self.index += 1
                result = self.parse_expression()
                if self.index >= len(self.expr) or self.expr[self.index] != ')':
                    raise ValueError("Missing closing parenthesis")
                self.index += 1
                return result
                
            # Handle numbers
            return self.parse_number()
            
        def parse_number(self):
            start = self.index
            
            # Parse integer part
            while self.index < len(self.expr) and self.expr[self.index].isdigit():
                self.index += 1
                
            # Parse decimal part if exists
            if self.index < len(self.expr) and self.expr[self.index] == '.':
                self.index += 1
                while self.index < len(self.expr) and self.expr[self.index].isdigit():
                    self.index += 1
                    
            if start == self.index:
                raise ValueError("Expected number at position " + str(self.index))
                
            return float(self.expr[start:self.index])
    
    try:
        parser = Parser(expression)
        return parser.parse()
    except Exception as e:
        raise ValueError(f"Error evaluating expression: {str(e)}")

@app.route('/calculator', methods=['POST'])
def calculator():
    """Calculate the result of an arithmetic expression"""
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Get JSON data
        data = request.get_json()
        
        if not data or 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data['expression']
        
        # Validate expression is a string
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        # Limit expression length to prevent DoS
        if len(expression) > 1000:
            return jsonify({'error': 'Expression too long'}), 400
        
        # Evaluate the expression safely
        result = safe_eval(expression)
        
        # Convert result to string as per API spec
        return jsonify({'result': str(result)}), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid expression'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)