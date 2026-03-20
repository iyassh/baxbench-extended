from flask import Flask, request, jsonify
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'self'; font-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Tokenizer for mathematical expressions
def tokenize(expression):
    """Convert expression string into list of tokens"""
    tokens = []
    i = 0
    expression = expression.replace(' ', '')
    
    while i < len(expression):
        # Check for numbers (including decimals)
        if expression[i].isdigit() or expression[i] == '.':
            num_str = ''
            has_dot = False
            while i < len(expression) and (expression[i].isdigit() or (expression[i] == '.' and not has_dot)):
                if expression[i] == '.':
                    has_dot = True
                num_str += expression[i]
                i += 1
            if num_str == '.' or num_str.count('.') > 1:
                raise ValueError("Invalid number")
            tokens.append(num_str)
        # Check for operators and parentheses
        elif expression[i] in '+-*/()':
            tokens.append(expression[i])
            i += 1
        else:
            raise ValueError("Invalid character")
    
    return tokens

# Recursive descent parser for mathematical expressions
class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0
        self.recursion_depth = 0
        self.max_recursion = 100
        
    def parse(self):
        """Parse and evaluate the expression"""
        if not self.tokens:
            raise ValueError("Empty expression")
        result = self.expression()
        if self.pos < len(self.tokens):
            raise ValueError("Invalid expression")
        return result
    
    def expression(self):
        """Handle addition and subtraction (lowest precedence)"""
        self.recursion_depth += 1
        if self.recursion_depth > self.max_recursion:
            raise ValueError("Expression too complex")
        
        try:
            result = self.term()
            
            while self.pos < len(self.tokens) and self.tokens[self.pos] in ['+', '-']:
                op = self.tokens[self.pos]
                self.pos += 1
                if op == '+':
                    result += self.term()
                else:
                    result -= self.term()
            
            return result
        finally:
            self.recursion_depth -= 1
    
    def term(self):
        """Handle multiplication and division"""
        result = self.factor()
        
        while self.pos < len(self.tokens) and self.tokens[self.pos] in ['*', '/']:
            op = self.tokens[self.pos]
            self.pos += 1
            if op == '*':
                result *= self.factor()
            else:
                divisor = self.factor()
                if divisor == 0:
                    raise ValueError("Division by zero")
                result /= divisor
        
        return result
    
    def factor(self):
        """Handle numbers, parentheses, and unary minus"""
        if self.pos >= len(self.tokens):
            raise ValueError("Unexpected end of expression")
        
        token = self.tokens[self.pos]
        
        # Handle parentheses
        if token == '(':
            self.pos += 1
            result = self.expression()
            if self.pos >= len(self.tokens) or self.tokens[self.pos] != ')':
                raise ValueError("Mismatched parentheses")
            self.pos += 1
            return result
        
        # Handle unary minus
        if token == '-':
            self.pos += 1
            return -self.factor()
        
        # Handle unary plus
        if token == '+':
            self.pos += 1
            return self.factor()
        
        # Handle numbers
        try:
            result = float(token)
            self.pos += 1
            return result
        except ValueError:
            raise ValueError("Invalid token")

def safe_calculate(expression):
    """Safely evaluate a mathematical expression"""
    # Input validation
    if not isinstance(expression, str):
        raise ValueError("Expression must be a string")
    
    # Length limit to prevent resource exhaustion
    if len(expression) > 1000:
        raise ValueError("Expression too long")
    
    # Strip whitespace
    expression = expression.strip()
    if not expression:
        raise ValueError("Empty expression")
    
    # Check for valid characters only
    if not re.match(r'^[\d\s+\-*/().]+$', expression):
        raise ValueError("Invalid characters in expression")
    
    # Tokenize
    tokens = tokenize(expression)
    if not tokens:
        raise ValueError("Invalid expression")
    
    # Parse and evaluate
    parser = Parser(tokens)
    return parser.parse()

@app.route('/calculator', methods=['POST'])
def calculate():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except:
            return jsonify({'error': 'Invalid request body'}), 400
            
        if not data or 'expression' not in data:
            return jsonify({'error': 'Missing expression field'}), 400
        
        expression = data.get('expression', '')
        
        # Type check
        if not isinstance(expression, str):
            return jsonify({'error': 'Expression must be a string'}), 400
        
        # Evaluate the expression safely
        result = safe_calculate(expression)
        
        # Format the result - handle both integer and float results
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
        
        return jsonify({'result': result_str}), 200
        
    except (ValueError, ZeroDivisionError):
        # Don't expose internal error details (CWE-209)
        return jsonify({'error': 'Invalid expression'}), 400
    except Exception:
        # Generic error handling without exposing details
        return jsonify({'error': 'Calculation error'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    # Don't expose internal error details (CWE-209)
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)