from flask import Flask, request, jsonify
import re

app = Flask(__name__)

class SafeMathEvaluator:
    def __init__(self):
        self.max_length = 1000
        self.max_operations = 100
        self.max_depth = 50
        
    def evaluate(self, expression):
        # Resource exhaustion prevention (CWE-400)
        if len(expression) > self.max_length:
            raise ValueError("Expression too long")
            
        # Remove whitespace
        expression = expression.replace(' ', '')
        
        # Prevent code injection (CWE-94) - whitelist allowed characters
        if not re.match(r'^[\d+\-*/().\s]+$', expression):
            raise ValueError("Invalid characters in expression")
            
        # Limit operations to prevent resource exhaustion
        op_count = sum(1 for c in expression if c in '+-*/')
        if op_count > self.max_operations:
            raise ValueError("Too many operations")
            
        # Check parentheses balance
        if expression.count('(') != expression.count(')'):
            raise ValueError("Unbalanced parentheses")
            
        self.expr = expression
        self.pos = 0
        self.depth = 0
        
        result = self._parse_expression()
        
        if self.pos < len(self.expr):
            raise ValueError("Invalid expression")
            
        # Check for special values
        if result != result:  # NaN check
            raise ValueError("Invalid result")
        if abs(result) == float('inf'):
            raise ValueError("Result overflow")
            
        return result
    
    def _parse_expression(self):
        self.depth += 1
        if self.depth > self.max_depth:
            raise ValueError("Expression too complex")
            
        result = self._parse_term()
        
        while self.pos < len(self.expr):
            if self._peek() == '+':
                self._consume()
                result += self._parse_term()
            elif self._peek() == '-':
                self._consume()
                result -= self._parse_term()
            else:
                break
                
        self.depth -= 1
        return result
    
    def _parse_term(self):
        result = self._parse_factor()
        
        while self.pos < len(self.expr):
            if self._peek() == '*':
                self._consume()
                result *= self._parse_factor()
            elif self._peek() == '/':
                self._consume()
                divisor = self._parse_factor()
                if divisor == 0:
                    raise ValueError("Division by zero")
                result /= divisor
            else:
                break
                
        return result
    
    def _parse_factor(self):
        # Handle parentheses
        if self._peek() == '(':
            self._consume()
            result = self._parse_expression()
            if self._peek() != ')':
                raise ValueError("Missing closing parenthesis")
            self._consume()
            return result
        
        # Handle unary operators
        if self._peek() == '-':
            self._consume()
            return -self._parse_factor()
        elif self._peek() == '+':
            self._consume()
            return self._parse_factor()
        
        # Parse number
        return self._parse_number()
    
    def _parse_number(self):
        start = self.pos
        has_dot = False
        
        while self.pos < len(self.expr):
            ch = self.expr[self.pos]
            if ch.isdigit():
                self.pos += 1
            elif ch == '.' and not has_dot:
                has_dot = True
                self.pos += 1
            else:
                break
                
        if start == self.pos:
            raise ValueError("Expected number")
            
        num_str = self.expr[start:self.pos]
        try:
            return float(num_str) if '.' in num_str else int(num_str)
        except ValueError:
            raise ValueError("Invalid number")
    
    def _peek(self):
        if self.pos < len(self.expr):
            return self.expr[self.pos]
        return None
    
    def _consume(self):
        self.pos += 1

evaluator = SafeMathEvaluator()

@app.route('/calculator', methods=['POST'])
def calculator():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Get JSON data with exception handling (CWE-703)
        try:
            data = request.get_json(force=False)
        except Exception:
            # Don't expose internal error details (CWE-209)
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate input structure
        if not data or 'expression' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        expression = data.get('expression')
        
        # Type validation
        if not isinstance(expression, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Empty check
        if not expression.strip():
            return jsonify({'error': 'Invalid input'}), 400
        
        # Evaluate the expression safely
        try:
            result = evaluator.evaluate(expression)
            return jsonify({'result': str(result)}), 200
        except Exception:
            # Generic error response to avoid information disclosure (CWE-209)
            return jsonify({'error': 'Invalid input'}), 400
            
    except Exception:
        # Catch-all exception handler (CWE-703)
        return jsonify({'error': 'Invalid input'}), 400

# Add security headers to all responses (CWE-693)
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

# Global error handler to prevent information disclosure (CWE-209, CWE-703)
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)